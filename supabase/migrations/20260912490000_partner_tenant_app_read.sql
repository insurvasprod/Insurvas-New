-- Give tenant_app the read path on partners that LA-1.1 declared and this database never got.
--
-- 20260902100000 declares, for the tenant plane:
--
--   grant select on public.partners, public.partner_terms, public.partner_users to tenant_app;
--   create policy partners_tenant_read      on public.partners      for select to tenant_app ...
--   create policy partner_terms_tenant_read on public.partner_terms for select to tenant_app ...
--   create policy partner_users_tenant_read on public.partner_users for select to tenant_app ...
--
-- None of it is here. All three tables pre-date this application -- they are the shared
-- organizations-era tables -- so the reconciliation left statements targeting them alone, and the
-- grants and policies went with them. `tenant_app` holds no privilege on any of the three, and a
-- direct read fails with
--
--   42501 permission denied for table partners
--
-- which is where verify-partners dies. LA-1.1's "direct tenant_app reads cannot cross tenants" has
-- never been demonstrable, because the role cannot read the table at all.
--
-- The two policies that DO exist on public.partners are the CRM's: `partners_select` and
-- `partners_write`, both `to authenticated`, both keyed on organization_id through
-- private.is_org_member(). They are untouched here.
--
-- Why this is additive despite being a policy change on a shared table. A row-level security policy
-- applies only to the roles it names. Adding a policy `to tenant_app` cannot alter what
-- `authenticated` sees, because Postgres evaluates only the policies matching the current role --
-- the CRM's two policies remain the whole of its behaviour. And the grant is SELECT only, to a role
-- that is NOBYPASSRLS, under a predicate that reduces to tenant_id = the session's tenant. A
-- session with no app.tenant_id set sees nothing rather than everything: nullif('', '')::uuid is
-- null, and `tenant_id = null` is never true.
--
-- partner_terms and partner_users get the same treatment in the same statement, because all three
-- come from one declaration and granting one of them alone leaves the other two still unreadable --
-- which is the shape of gap this whole exercise keeps finding.

grant select on public.partners, public.partner_terms, public.partner_users to tenant_app;

drop policy if exists partners_tenant_read on public.partners;
create policy partners_tenant_read on public.partners for select to tenant_app
using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists partner_terms_tenant_read on public.partner_terms;
create policy partner_terms_tenant_read on public.partner_terms for select to tenant_app
using (exists (
  select 1 from public.partners p
   where p.id = partner_id
     and p.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
));

drop policy if exists partner_users_tenant_read on public.partner_users;
create policy partner_users_tenant_read on public.partner_users for select to tenant_app
using (exists (
  select 1 from public.partners p
   where p.id = partner_id
     and p.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
));

-- Assert both halves, and assert the CRM's policies survived. The second is the one worth checking:
-- this is a policy change on a table another product depends on.
do $$
declare
  missing text;
  crm_policies integer;
begin
  select string_agg(t.name, ', ') into missing
  from unnest(array['partners', 'partner_terms', 'partner_users']) as t(name)
  where not exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = t.name
       and g.grantee = 'tenant_app' and g.privilege_type = 'SELECT'
  );
  if missing is not null then
    raise exception 'tenant_app still cannot select: %', missing;
  end if;

  select count(*) into crm_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'partners'
     and policyname in ('partners_select', 'partners_write');
  if crm_policies <> 2 then
    raise exception 'the CRM partners policies are no longer both present (found %)', crm_policies;
  end if;
end;
$$;
