-- Producer rows for agency members who joined before their agency record existed (owner 2026-11-20, manager walk).
--
-- Found on "Demo · Agency 1-50": two producers and two managers are members (tenant_users role 'producer'), but the
-- agency had no agency row and no producer rows. So Agency › Producers said "No producers yet", a manager had no
-- reports, the submit gate (AG-1.10) refused every writer ("not set up as a producer yet"), and Invite refused them
-- as "This person is already on your team". 20261018260000 backfilled exactly this once, for the agencies of that
-- day; members seeded or added since were never given a row, and Finish agency setup (AG-0.8) makes only the owner
-- producer #1.
--
-- This file:
--   1. public.agency_add_member_producers(p_tenant_id) — 20261018260000's steps for ONE tenant: the agency row if
--      missing, a producer row for the owner and for every member whose base role is producer (managers included),
--      accepted → 'onboarding' (the checklist moves him to active, AG-1.10; the same state producer_on_accept gives an
--      invited producer who accepts), still invited → 'invited'; hired_on = when they joined; NPN from the producer
--      profile; can_submit from its one writer. Attributes NO business rows (D1). Idempotent. Service role only:
--      the app calls it from Finish agency setup (lib/agency/upgradeStore.ts).
--   2. Runs it once for every agency-audience tenant, so the agencies that already have this gap are fixed now.
--
-- Rollback: drop function public.agency_add_member_producers(uuid); the rows it made carry no ledger, hierarchy,
-- level or writing-number row until someone adds one, and can be deleted by created_at.

begin;

create or replace function public.agency_add_member_producers(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_made integer := 0;
  v record;
begin
  if public.tenant_plan_audience(p_tenant_id) <> 'agency' then
    return 0;
  end if;

  insert into public.agency (tenant_id, legal_name, dba_name, npn, primary_state)
  select t.id, coalesce(nullif(btrim(ap.legal_name), ''), t.name), nullif(btrim(ap.dba), ''), nullif(btrim(ap.npn), ''),
         case when upper(ap.state) ~ '^[A-Z]{2}$' then upper(ap.state) end
    from public.tenants t left join public.agency_profiles ap on ap.tenant_id = t.id
   where t.id = p_tenant_id
  on conflict (tenant_id) do nothing;
  select id into v_agency from public.agency where tenant_id = p_tenant_id;

  for v in
    with made as (
    insert into public.producer (tenant_id, agency_id, user_id, display_name, npn, status, hired_on)
    select tu.tenant_id, v_agency, tu.user_id,
           left(coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), 'Producer'), 200),
           nullif(btrim(pp.npn), ''),
           case when tu.accepted_at is null then 'invited'
                when tu.user_id = public.tenant_owner_user(tu.tenant_id) then 'active'
                else 'onboarding' end,
           coalesce(tu.accepted_at, tu.invited_at, now())::date
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
      left join public.tenant_user_producer_profiles pp on pp.tenant_id = tu.tenant_id and pp.user_id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and (tu.role::text = 'producer' or tu.user_id = public.tenant_owner_user(tu.tenant_id))
    on conflict on constraint producer_one_per_member do nothing
    returning id, status
    )
    select made.id, made.status from made
  loop
    v_made := v_made + 1;
    if v.status in ('onboarding', 'active') then
      perform public.producer_refresh_can_submit(p_tenant_id, v.id);
    end if;
  end loop;

  return v_made;
end;
$$;

revoke all on function public.agency_add_member_producers(uuid) from public, anon, authenticated;
grant execute on function public.agency_add_member_producers(uuid) to service_role;

-- Fix the agencies that have this gap today.
do $$
declare
  v record;
  v_total integer := 0;
begin
  for v in select t.id from public.tenants t where public.tenant_plan_audience(t.id) = 'agency' loop
    v_total := v_total + public.agency_add_member_producers(v.id);
  end loop;
  raise notice 'agency_add_member_producers: % producer rows added', v_total;
end;
$$;

-- Self-check: no agency member with base role producer is left without a producer row.
do $$
begin
  if exists (
    select 1 from public.tenant_users tu
     where tu.role::text = 'producer'
       and public.tenant_plan_audience(tu.tenant_id) = 'agency'
       and not exists (select 1 from public.producer p where p.tenant_id = tu.tenant_id and p.user_id = tu.user_id)
     limit 1) then
    raise exception 'agency_add_member_producers: a producer member still has no producer row';
  end if;
end;
$$;

commit;

-- Check: the demo agency's roster.
select p.display_name, p.status, p.can_submit, p.can_submit_reason
  from public.producer p
 where p.tenant_id = '9ee9d63d-5474-42e5-b184-73056b5ca5ee'
 order by p.display_name;
