-- The last four tables from the tenant_app access survey: the tenant_template family.
--
-- 20260913100000 fixed fifteen and deliberately left these, because they had a grant declared and
-- no policy naming tenant_app -- and granting without a policy produces the silent variant, a table
-- that reads as zero rows forever and never errors. The policy decision was owed first. This is it.
--
-- What this repository declares, in 0009_tenant_template_copies.sql and 20260902141500:
--
--   tenant_templates_scoped         for all to public  using tenant_id = app.tenant_id
--   tenant_template_fields_scoped   for all to public  using tenant_template_id in (...)
--   tenant_template_stages_scoped   for all to public  using tenant_template_id in (...)
--   tenant_template_forms_scoped    for all to public  using tenant_template_id in (...)
--
-- and a grant of select/insert/update/delete to tenant_app. None of it is in this database. What is
-- here instead is one organizations-era policy per table -- tenant_templates_member_select and its
-- three siblings, all `to authenticated` -- which are the CRM's and are left untouched.
--
-- ONE DELIBERATE DEVIATION FROM THE DECLARATION, and it is the reason this needed its own migration.
-- The repo says `to public`. A TO PUBLIC policy applies to every role, so adding one here would also
-- apply to `authenticated`, which the CRM uses on these same tables. Policies are OR-ed, so that
-- would widen what the CRM's sessions can see rather than leaving them alone.
--
-- In practice the predicate could not match for such a session -- app.tenant_id is unset there, and
-- nullif('', '')::uuid is null, so `tenant_id = null` is never true -- but "it cannot match" is a
-- weaker guarantee than "it does not apply", and the difference is one misconfigured session. These
-- are created TO TENANT_APP instead. Same predicates, same effect for this application, and no
-- possibility of touching another product's access.
--
-- The three child predicates are the declaration's, unchanged: membership of the parent copy, which
-- is itself tenant-scoped by the first policy. Scoping the children through the parent rather than
-- repeating tenant_id is what the repo chose, and it keeps one definition of who owns a copy.

grant select, insert, update, delete
  on public.tenant_templates, public.tenant_template_fields,
     public.tenant_template_stages, public.tenant_template_forms
  to tenant_app;

drop policy if exists tenant_templates_scoped on public.tenant_templates;
create policy tenant_templates_scoped on public.tenant_templates
  for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tenant_template_fields_scoped on public.tenant_template_fields;
create policy tenant_template_fields_scoped on public.tenant_template_fields
  for all to tenant_app
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

drop policy if exists tenant_template_stages_scoped on public.tenant_template_stages;
create policy tenant_template_stages_scoped on public.tenant_template_stages
  for all to tenant_app
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

drop policy if exists tenant_template_forms_scoped on public.tenant_template_forms;
create policy tenant_template_forms_scoped on public.tenant_template_forms
  for all to tenant_app
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

-- Assert both halves, and assert the CRM's four policies survived — this migration touches tables
-- another product reads, so "I did not break theirs" is a claim worth checking rather than stating.
do $$
declare
  incomplete text;
  crm_policies integer;
begin
  select string_agg(t.name, ', ') into incomplete
  from unnest(array['tenant_templates', 'tenant_template_fields',
                    'tenant_template_stages', 'tenant_template_forms']) as t(name)
  where not (
    exists (select 1 from information_schema.role_table_grants g
             where g.table_schema = 'public' and g.table_name = t.name and g.grantee = 'tenant_app')
    and exists (select 1 from pg_policy p
                 join pg_class c on c.oid = p.polrelid
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = t.name
                  and 'tenant_app' = any (select rolname from pg_roles where oid = any (p.polroles)))
  );
  if incomplete is not null then
    raise exception 'still incomplete: %', incomplete;
  end if;

  select count(*) into crm_policies
    from pg_policies
   where schemaname = 'public'
     and policyname in ('tenant_templates_member_select', 'tenant_template_fields_member_select',
                        'tenant_template_stages_member_select', 'tenant_template_forms_member_select');
  if crm_policies <> 4 then
    raise exception 'expected the 4 organizations-era member_select policies to survive, found %', crm_policies;
  end if;
end;
$$;
