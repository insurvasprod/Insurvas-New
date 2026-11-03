-- AG follow-up (outside the 24 Notion tasks) · producer rows for the agency tenants that existed BEFORE Agency Module 0.
--
-- Found 2026-10-18 by the live check: three tenants were already on agency-audience plans when the AG migrations
-- landed (LA-1.25 Alert Demo, QA Load Test Workspace, QA Load Test Empty Workspace). Producer rows are created
-- only by an invite (AG-0.6) or the solo upgrade (AG-0.8), so their owners and producers have none — and the
-- submit gate (AG-1.10) refuses an agency writer with no producer row ("not set up as a producer yet").
--
-- What this does, for every agency-audience tenant, exactly as AG-0.8 does for one upgraded solo tenant:
--   1. an agency row if missing (legal name from the business profile)
--   2. a producer row for the owner (producer #1, as in AG-0.8) and for every member whose base role is producer
--      (managers included — a manager is a producer with a title): accepted → active, still invited → invited;
--      hired_on = when they joined; NPN from their producer profile
--   3. can_submit computed by its ONE writer, producer_refresh_can_submit — never set here. A producer whose
--      checklist is incomplete is refused with the specific missing item, which is the spec (AG-1.10)
--
-- It attributes NO business rows: existing leads, applications and commissions keep the user ids they already
-- carry (D1), which these producers' rows now match. Idempotent: a second run inserts nothing.
--
-- Requires 20261018100000…20261018250000 (all live 2026-10-18).
--
-- Rollback: delete from public.producer where created_at during this run and status in ('active', 'invited') and
--   no ledger, hierarchy, level or writing-number row points at it (none can yet).

-- 1. the agency row
insert into public.agency (tenant_id, legal_name, dba_name, npn, primary_state)
select t.id, coalesce(nullif(btrim(ap.legal_name), ''), t.name), nullif(btrim(ap.dba), ''), nullif(btrim(ap.npn), ''),
       case when upper(ap.state) ~ '^[A-Z]{2}$' then upper(ap.state) end
  from public.tenants t left join public.agency_profiles ap on ap.tenant_id = t.id
 where public.tenant_plan_audience(t.id) = 'agency'
on conflict (tenant_id) do nothing;

-- 2. the producers
insert into public.producer (tenant_id, agency_id, user_id, display_name, npn, status, hired_on)
select tu.tenant_id, a.id, tu.user_id,
       left(coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), 'Producer'), 200),
       nullif(btrim(pp.npn), ''),
       case when tu.accepted_at is null then 'invited' else 'active' end,
       coalesce(tu.accepted_at, tu.invited_at)::date
  from public.tenant_users tu
  join public.agency a on a.tenant_id = tu.tenant_id
  join public.users u on u.id = tu.user_id
  left join public.tenant_user_producer_profiles pp on pp.tenant_id = tu.tenant_id and pp.user_id = tu.user_id
 where public.tenant_plan_audience(tu.tenant_id) = 'agency'
   and (tu.role::text = 'producer' or tu.user_id = public.tenant_owner_user(tu.tenant_id))
on conflict on constraint producer_one_per_member do nothing;

-- 3. can_submit, from its one writer
do $$
declare
  v record;
begin
  for v in
    select p.tenant_id, p.id from public.producer p
     where p.status in ('onboarding', 'active') and p.can_submit_checked_at is null
       and public.tenant_plan_audience(p.tenant_id) = 'agency'
  loop
    perform public.producer_refresh_can_submit(v.tenant_id, v.id);
  end loop;
end;
$$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing integer;
  v_unchecked integer;
begin
  select count(*) into v_missing
    from public.tenant_users tu
   where public.tenant_plan_audience(tu.tenant_id) = 'agency'
     and (tu.role::text = 'producer' or tu.user_id = public.tenant_owner_user(tu.tenant_id))
     and not exists (select 1 from public.producer p where p.tenant_id = tu.tenant_id and p.user_id = tu.user_id);
  if v_missing > 0 then
    raise exception 'AG backfill: % agency writer(s) still have no producer row', v_missing;
  end if;
  select count(*) into v_unchecked from public.producer p
   where p.status in ('onboarding', 'active') and p.can_submit_checked_at is null
     and public.tenant_plan_audience(p.tenant_id) = 'agency';
  if v_unchecked > 0 then
    raise exception 'AG backfill: % working producer(s) never had can_submit computed', v_unchecked;
  end if;
end;
$$;
