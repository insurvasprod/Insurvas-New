-- AG-0.2 (Notion sprint, Agency Module 0) · the agency's two extra roles, admin and manager, on the join row.
--
-- The spec names seven roles: owner, admin, manager, producer, assistant, bookkeeper, retention. The first
-- five-and-setter already exist as tenant_user_role. admin and manager do not.
--
-- WHY NOT TWO NEW ENUM VALUES. 44 live SQL functions gate on tenant_users.role ('owner', 'producer' …):
-- lead eligibility, callback assignees, the invite and deactivate RPCs, queue ownership. A new enum value is
-- admitted by none of them, so a manager could not be assigned a lead and an admin could not invite. Instead
-- the role keeps its AUTHORITY and the agency adds a TITLE on the same join row (decision D11):
--
--   tenant_users.agency_role  null | 'admin' | 'manager'
--     admin    rides on role 'owner'    — everything an owner can do EXCEPT billing and plan changes
--                                         (the app refuses those for agency_role = 'admin').
--     manager  rides on role 'producer' — a producer, plus his direct reports (AG-0.3 / AG-0.4).
--
-- Permissions stay per tenant, on tenant_users — never a role column on users (spec rule). A role the app's
-- matrix does not name has no permissions (default deny, lib/tenantAuth/permissions.ts).
--
-- The billing owner is the owner whose agency_role is null. There must always be one:
--   tenant_owner_user      prefers a real owner over an admin.
--   tenant_update_member_role  'last_owner' now counts real owners, and clears a title the new role
--                          cannot carry.
--   tenant_set_member_agency_role  the one writer of the title; agency-audience tenants only.
--
-- Requires 20261018100000 (tenant_plan_audience).
--
-- Rollback:
--   alter table public.tenant_users drop column if exists agency_role;
--   drop function if exists public.tenant_set_member_agency_role(uuid, uuid, text);
--   (and restore tenant_owner_user / tenant_update_member_role from their previous definitions)

alter table public.tenant_users add column if not exists agency_role text;
alter table public.tenant_users drop constraint if exists tenant_users_agency_role;
alter table public.tenant_users add constraint tenant_users_agency_role check (
  agency_role is null
  or (agency_role = 'admin' and role::text = 'owner')
  or (agency_role = 'manager' and role::text = 'producer')
);
-- Only the title's own function writes it. A column revoke is void while the TABLE privilege stands, so the
-- table privilege goes and every other column is granted back exactly as before (no code writes agency_role).
revoke insert, update on public.tenant_users from service_role, authenticated;
grant insert (tenant_id, user_id, role, invited_at, accepted_at, timezone) on public.tenant_users to service_role, authenticated;
grant update (tenant_id, user_id, role, invited_at, accepted_at, timezone) on public.tenant_users to service_role, authenticated;

-- One guard for every writer of tenant_users (tenant_update_member_role, …_with_limit, admin console RPCs):
--   · a role change drops a title the new role cannot carry, instead of failing the check constraint;
--   · the last REAL owner (no title) can never stop being one, whichever function tried;
--   · a title exists only inside an agency.
create or replace function public.tenant_users_agency_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.agency_role = 'admin' and new.role::text <> 'owner' then new.agency_role := null; end if;
  if new.agency_role = 'manager' and new.role::text <> 'producer' then new.agency_role := null; end if;
  if tg_op = 'UPDATE' and old.role::text = 'owner' and old.agency_role is null
     and (new.role::text <> 'owner' or new.agency_role is not null)
     and not exists (select 1 from public.tenant_users t
                      where t.tenant_id = new.tenant_id and t.user_id <> new.user_id and t.role::text = 'owner' and t.agency_role is null) then
    raise exception 'last_owner' using errcode = 'P0001', hint = 'Someone must remain the owner who holds billing.';
  end if;
  if new.agency_role is not null and coalesce(public.tenant_plan_audience(new.tenant_id), '') <> 'agency' then
    raise exception 'agency_role_needs_agency_plan' using errcode = 'P0001',
      hint = 'Admin and manager exist only on an agency plan.';
  end if;
  return new;
end;
$$;
revoke all on function public.tenant_users_agency_role_guard() from public, anon, authenticated;
drop trigger if exists tenant_users_agency_role_guard on public.tenant_users;
create trigger tenant_users_agency_role_guard
  before insert or update of agency_role, role on public.tenant_users
  for each row execute function public.tenant_users_agency_role_guard();

-- ─── the billing owner is a real owner ────────────────────────────────────────────────────────────
create or replace function public.tenant_owner_user(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.user_id from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.role = 'owner'
   order by (tu.agency_role is not null), (tu.accepted_at is null), tu.accepted_at, tu.invited_at
   limit 1
$$;

create or replace function public.tenant_update_member_role(p_tenant_id uuid, p_user_id uuid, p_role tenant_user_role)
returns table(old_role tenant_user_role, new_role tenant_user_role)
language plpgsql
security definer
set search_path = public
as $$
declare v_old public.tenant_user_role; v_title text; v_org uuid; v_role uuid;
begin
  select role, agency_role into v_old, v_title from public.tenant_users where tenant_id=p_tenant_id and user_id=p_user_id for update;
  if v_old is null then raise exception 'member_not_found'; end if;
  -- AG-0.2: the last REAL owner (no admin title) cannot be demoted; an admin is not a billing owner.
  if v_old='owner' and v_title is null and p_role<>'owner'
     and (select count(*) from public.tenant_users where tenant_id=p_tenant_id and role='owner' and agency_role is null) <= 1 then
    raise exception 'last_owner';
  end if;
  -- A title the new role cannot carry is dropped with the change (admin needs owner, manager needs producer).
  update public.tenant_users
     set role=p_role,
         agency_role = case when (agency_role='admin' and p_role::text='owner') or (agency_role='manager' and p_role::text='producer') then agency_role end
   where tenant_id=p_tenant_id and user_id=p_user_id;
  select source_organization_id into v_org from public.tenants where id=p_tenant_id;
  select id into v_role from public.roles where key=case p_role::text when 'owner' then 'owner' when 'producer' then 'sales_agent_licensed' when 'assistant' then 'sales_agent_unlicensed' when 'bookkeeper' then 'accounting' end limit 1;
  if v_org is not null and to_regclass('public.organization_members') is not null then update public.organization_members set role_id=v_role, updated_at=now() where organization_id=v_org and user_id=p_user_id and status='active'; end if;
  return query select v_old,p_role;
end; $$;

-- ─── the one writer of the title ──────────────────────────────────────────────────────────────────
-- p_member_role is the role a person is GIVEN on the team screen: one of the seven, plus setter.
-- admin → (owner, 'admin'); manager → (producer, 'manager'); anything else → (that role, null).
create or replace function public.tenant_set_member_agency_role(p_tenant_id uuid, p_user_id uuid, p_member_role text)
returns table(role text, agency_role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_title text;
begin
  if p_member_role not in ('owner', 'admin', 'manager', 'producer', 'assistant', 'bookkeeper', 'setter', 'retention') then
    raise exception 'unknown_role' using errcode = 'P0001';
  end if;
  v_base := case p_member_role when 'admin' then 'owner' when 'manager' then 'producer' else p_member_role end;
  v_title := case when p_member_role in ('admin', 'manager') then p_member_role end;
  if v_title is not null and coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then
    raise exception 'agency_role_needs_agency_plan' using errcode = 'P0001';
  end if;
  -- Demoting the last real owner to admin is refused: someone must hold billing.
  if v_title = 'admin' and exists (
       select 1 from public.tenant_users t where t.tenant_id = p_tenant_id and t.user_id = p_user_id and t.role = 'owner' and t.agency_role is null)
     and (select count(*) from public.tenant_users t where t.tenant_id = p_tenant_id and t.role = 'owner' and t.agency_role is null) <= 1 then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  perform public.tenant_update_member_role(p_tenant_id, p_user_id, v_base::public.tenant_user_role);
  update public.tenant_users t set agency_role = v_title where t.tenant_id = p_tenant_id and t.user_id = p_user_id;
  return query select v_base, v_title;
end;
$$;
revoke all on function public.tenant_set_member_agency_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tenant_set_member_agency_role(uuid, uuid, text) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_column_privilege('service_role', 'public.tenant_users', 'agency_role', 'UPDATE')
     or has_column_privilege('service_role', 'public.tenant_users', 'agency_role', 'INSERT')
     or has_column_privilege('authenticated', 'public.tenant_users', 'agency_role', 'UPDATE') then
    raise exception 'AG-0.2: service_role can write tenant_users.agency_role directly';
  end if;
  if exists (select 1 from public.tenant_users where agency_role is not null) then
    raise exception 'AG-0.2: a title exists before any was granted';
  end if;
  if pg_get_functiondef('public.tenant_owner_user(uuid)'::regprocedure) not like '%agency_role is not null%' then
    raise exception 'AG-0.2: tenant_owner_user still picks an admin as the billing owner';
  end if;
end;
$$;
