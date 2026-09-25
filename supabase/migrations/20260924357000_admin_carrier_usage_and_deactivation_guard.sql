-- ---------------------------------------------------------------------------
-- Platform carrier usage, and no deactivating a carrier tenants still use (board p-adm-carriers)
--
-- The staff console's Carriers page is the platform library every tenant picks from (Settings ›
-- Carrier library, Appointments, the statement import). Deactivating a carrier hides it from those
-- pickers, drops the tenant's contract rows for it out of Settings › Carrier library, and leaves its
-- appointments showing "Carrier" instead of a name. Until now that happened with one click and no
-- count of who it would hit.
--
-- User decision: a carrier any tenant USES cannot be deactivated. "Uses" means, per tenant,
--   · an active contract   tenant_carriers.is_active (one active row per tenant and carrier), or
--   · an open appointment  appointments.status <> 'terminated' and not past terminated_at.
-- A super admin may override with a written reason; the route requires the reason and the role,
-- audits it, and calls admin_set_carrier_active, which is the only thing that raises the override.
--
-- What this file adds (additive and idempotent; one backfill of the legacy status column):
--   1. admin_carrier_usage(p_carrier_id)   per platform carrier: tenants, contract tenants,
--                                          appointment tenants, open and recorded appointments.
--   2. admin_carrier_usage_totals()        distinct tenants across the library, appointment totals.
--   3. carriers_platform_state()           BEFORE INSERT OR UPDATE row trigger on platform rows:
--        · keeps the legacy `status` column (active | paused | archived, carriers_status_check on the
--          live database) in step with is_active, whichever of the two a writer changed;
--        · refuses active -> inactive while the carrier is in use, unless the transaction-local
--          setting app.carrier_deactivation_override is 'on' (check_violation, prefix carrier_in_use,
--          counts as JSON in DETAIL, which the route turns into a 409).
--   4. admin_set_carrier_active(...)       the one writer of that setting. It uses
--        set_config(..., is_local => true) — SET LOCAL — never a session SET: TENANT_DB_URL is the
--        transaction-mode pooler, where a session setting would outlive this call and leak into
--        whoever gets the backend next. It resets the setting as soon as its update is done.
--   5. carriers_platform_code_key          a partial unique index on code for platform rows. The live
--        table's only uniqueness is (organization_id, code), and NULLs are distinct, so two platform
--        rows could share a code. Skipped with a notice if duplicates already exist.
--
-- Organization-owned rows (organization_id is not null, the organization-era CRM) are untouched by
-- every part of this file.
-- ---------------------------------------------------------------------------

-- 1. Usage per platform carrier ---------------------------------------------------------------------

create or replace function public.admin_carrier_usage(p_carrier_id uuid default null)
returns table (
  carrier_id uuid,
  tenants integer,
  contract_tenants integer,
  appointment_tenants integer,
  open_appointments integer,
  appointments integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with platform as (
    select c.id
      from public.carriers c
     where c.organization_id is null
       and (p_carrier_id is null or c.id = p_carrier_id)
  ),
  contracts as (
    select tc.carrier_id, tc.tenant_id
      from public.tenant_carriers tc
      join platform p on p.id = tc.carrier_id
     where tc.is_active
  ),
  appts as (
    select a.carrier_id,
           a.tenant_id,
           (a.status <> 'terminated' and (a.terminated_at is null or a.terminated_at >= current_date)) as is_open
      from public.appointments a
      join platform p on p.id = a.carrier_id
  ),
  users as (
    select carrier_id, tenant_id from contracts
    union
    select carrier_id, tenant_id from appts where is_open
  )
  select p.id as carrier_id,
         coalesce((select count(distinct u.tenant_id) from users u where u.carrier_id = p.id), 0)::integer,
         coalesce((select count(distinct k.tenant_id) from contracts k where k.carrier_id = p.id), 0)::integer,
         coalesce((select count(distinct x.tenant_id) from appts x where x.carrier_id = p.id and x.is_open), 0)::integer,
         coalesce((select count(*) from appts x where x.carrier_id = p.id and x.is_open), 0)::integer,
         coalesce((select count(*) from appts x where x.carrier_id = p.id), 0)::integer
    from platform p;
$$;

comment on function public.admin_carrier_usage(uuid) is
  'Staff console Carriers: per platform carrier, the tenants using it (active contract or open appointment), split by kind, plus open and recorded appointments. Also the deactivation guard''s count. 20260924357000.';

-- 2. Totals across the library ----------------------------------------------------------------------

create or replace function public.admin_carrier_usage_totals()
returns table (tenants integer, appointments integer, open_appointments integer)
language sql
stable
security invoker
set search_path = public
as $$
  with platform as (
    select c.id from public.carriers c where c.organization_id is null
  ),
  appts as (
    select a.tenant_id,
           (a.status <> 'terminated' and (a.terminated_at is null or a.terminated_at >= current_date)) as is_open
      from public.appointments a
      join platform p on p.id = a.carrier_id
  ),
  users as (
    select tc.tenant_id
      from public.tenant_carriers tc
      join platform p on p.id = tc.carrier_id
     where tc.is_active
    union
    select tenant_id from appts where is_open
  )
  select (select count(distinct tenant_id) from users)::integer,
         (select count(*) from appts)::integer,
         (select count(*) from appts where is_open)::integer;
$$;

comment on function public.admin_carrier_usage_totals() is
  'Staff console Carriers: distinct tenants using any platform carrier, and appointments recorded / open against platform carriers. 20260924357000.';

-- Backfill the legacy status column before the trigger exists, so this update is not re-interpreted.
update public.carriers
   set status = case when is_active then 'active' else 'archived' end
 where organization_id is null
   and status is distinct from (case when is_active then 'active' else 'archived' end);

-- 3. The row trigger --------------------------------------------------------------------------------

create or replace function public.carriers_platform_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usage record;
begin
  if new.organization_id is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := case when new.is_active then 'active' else 'archived' end;
    return new;
  end if;

  -- Whichever of the two the writer changed wins; the other follows.
  if new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'active' else 'archived' end;
  elsif new.status is distinct from old.status then
    new.is_active := (new.status = 'active');
    new.status := case when new.is_active then 'active' else 'archived' end;
  end if;

  if old.is_active and not new.is_active then
    select u.* into v_usage from public.admin_carrier_usage(new.id) u;
    if coalesce(v_usage.tenants, 0) > 0
       and coalesce(current_setting('app.carrier_deactivation_override', true), '') <> 'on' then
      raise exception 'carrier_in_use: % is used by % tenant(s)', new.code, v_usage.tenants
        using errcode = 'check_violation',
              detail = json_build_object(
                'tenants', v_usage.tenants,
                'contract_tenants', v_usage.contract_tenants,
                'appointment_tenants', v_usage.appointment_tenants,
                'open_appointments', v_usage.open_appointments,
                'appointments', v_usage.appointments
              )::text,
              hint = 'A super admin can deactivate it from the staff console with a recorded reason.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.carriers_platform_state() is
  'Row trigger on carriers (platform rows only): keeps status in step with is_active, and refuses deactivating a carrier tenants use (carrier_in_use, check_violation) unless admin_set_carrier_active raised the transaction-local override. 20260924357000.';

drop trigger if exists carriers_platform_state on public.carriers;
create trigger carriers_platform_state
  before insert or update on public.carriers
  for each row
  execute function public.carriers_platform_state();

-- 4. The one writer of the override -----------------------------------------------------------------

create or replace function public.admin_set_carrier_active(
  p_carrier_id uuid,
  p_is_active boolean,
  p_override_reason text default null
)
returns table (
  id uuid,
  code text,
  name text,
  is_active boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_current boolean;
begin
  select c.is_active into v_current
    from public.carriers c
   where c.id = p_carrier_id and c.organization_id is null
   for update;

  if not found then
    raise exception 'carrier_not_found: %', p_carrier_id using errcode = 'no_data_found';
  end if;

  if p_override_reason is not null then
    if length(trim(p_override_reason)) < 10 then
      raise exception 'override_reason_too_short' using errcode = 'check_violation';
    end if;
    -- SET LOCAL: scoped to this transaction, so it cannot leak through the pooler.
    perform set_config('app.carrier_deactivation_override', 'on', true);
  end if;

  if v_current is distinct from p_is_active then
    update public.carriers c set is_active = p_is_active where c.id = p_carrier_id;
  end if;

  -- Only the update above was meant to see it.
  perform set_config('app.carrier_deactivation_override', '', true);

  return query
    select c.id, c.code, c.name, c.is_active, c.sort_order, c.created_at, c.updated_at
      from public.carriers c
     where c.id = p_carrier_id;
end;
$$;

comment on function public.admin_set_carrier_active(uuid, boolean, text) is
  'Staff console Carriers: activates or deactivates a platform carrier. A non-null reason (10+ characters) raises the transaction-local override the deactivation guard honours; the route requires super_admin for it and audits it. 20260924357000.';

-- Grants: service role only (the staff console's API). Revoke first so re-running is exact.
revoke all on function public.admin_carrier_usage(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_carrier_usage_totals() from public, anon, authenticated, tenant_app;
revoke all on function public.carriers_platform_state() from public, anon, authenticated, tenant_app;
revoke all on function public.admin_set_carrier_active(uuid, boolean, text) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_carrier_usage(uuid) to service_role;
grant execute on function public.admin_carrier_usage_totals() to service_role;
grant execute on function public.admin_set_carrier_active(uuid, boolean, text) to service_role;

-- 5. One code per platform carrier ------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from public.carriers c
     where c.organization_id is null
     group by c.code
    having count(*) > 1
  ) then
    raise notice '20260924357000: carriers_platform_code_key skipped, two platform carriers share a code; the API still refuses new duplicates';
  else
    execute 'create unique index if not exists carriers_platform_code_key on public.carriers (code) where organization_id is null';
  end if;
end;
$$;

-- Assertions ----------------------------------------------------------------------------------------

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924357000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_carrier_usage(uuid)') is null
     or to_regprocedure('public.admin_carrier_usage_totals()') is null
     or to_regprocedure('public.admin_set_carrier_active(uuid,boolean,text)') is null then
    raise exception '20260924357000: a carrier usage function is missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.carriers'::regclass
       and t.tgname = 'carriers_platform_state'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
  ) then
    raise exception '20260924357000: trigger carriers_platform_state is missing or disabled';
  end if;

  if pg_get_functiondef('public.admin_set_carrier_active(uuid,boolean,text)'::regprocedure)
       !~ 'set_config\(''app\.carrier_deactivation_override'', ''on'', true\)' then
    raise exception '20260924357000: the override is not transaction-local';
  end if;

  if exists (
    select 1 from public.carriers c
     where c.organization_id is null
       and c.status is distinct from (case when c.is_active then 'active' else 'archived' end)
  ) then
    raise exception '20260924357000: a platform carrier''s status disagrees with is_active';
  end if;

  if exists (
    select 1
      from public.admin_carrier_usage() u
     where u.tenants < greatest(u.contract_tenants, u.appointment_tenants)
        or u.open_appointments > u.appointments
  ) then
    raise exception '20260924357000: admin_carrier_usage returned inconsistent counts';
  end if;

  raise notice '20260924357000: carrier usage readable; carriers tenants use can no longer be deactivated without an override';
end;
$$;
