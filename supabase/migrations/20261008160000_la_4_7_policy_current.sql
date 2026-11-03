-- LA-4.7 (Notion sprint) · Layer 3: policy_current, one row per policy with its latest values and
-- the computed fields every LA-4 board and dashboard reads — and nothing else.
--
--   · DERIVED AND DISPOSABLE. Every row comes from Layer 2 (policy_snapshot, policy_change) plus the
--     carrier rules (LA-4.17), the advance rules (LA-0.4) and LA-3's submissions. One function writes
--     it: refresh_policy_current(tenant, carrier, policies, as_of). It deletes the rows in scope and
--     re-inserts them, so a full rebuild gives identical rows (no clock is stored, only `as_of`).
--   · Three ways in, one computation:
--       incremental — after each parsed file, for the policies that file touched;
--       daily       — every policy, because days past due moves with the calendar (pg_cron, 06:15 UTC);
--       full        — on demand, any scope.
--   · "Today" is the agency's day: agency_profiles.timezone, else UTC (the codebase's rule).
--
-- The computed fields:
--   annualised_premium_cents  premium × 12 / 4 / 2 / 1 by mode; null without a mode.
--   days_past_due             as_of − paid_to_date, floored at 0. From paid_to_date, NEVER the file date.
--   days_until_carrier_closes the carrier rule's window − days past due; NULL with no rule (LA-4.17's
--                             null-means-null). First payment rule until a payment is on record, then
--                             the ongoing payment rule. The rule used is kept in retention_rule_id.
--   status_normalized         the snapshot's, except `active` past the rule's grace becomes `at_risk` —
--                             the same value LA-4.5's map gives, so nothing downstream can tell them apart.
--   months_paid               whole months from effective_date to paid_to_date.
--   in_clawback_window        months_paid < the advance rule's clawback months; null with no rule.
--   risk_band                 none | watch | at_risk | critical, from observed facts only:
--                               critical = at risk and (inside the clawback window or past the carrier's window)
--                               at_risk  = at risk
--                               watch    = active with days past due, inside grace (or no grace rule)
--                               none     = everything else
--                             No threshold of its own and no prediction (LA-5 adds a separate, labelled score).
--   lapsed_on, issued_on      from policy_change (the file pair that showed the transition), not the file.
--   application_id, case_id   an LA-3 submission to the same carrier with the same policy number.
--   campaign_id, vendor_id    from that case (LA-2 attribution).
--
-- Null until their task ships, never guessed: contact_id, household_id (LA-4.8), agent_user_id (needs
-- an agent-code map), lead_cost_cents (LA-2 derives cost per lead, it stores none per policy), and the
-- money fields total_advanced/earned/charged_back and unearned_advance (LA-4.12's ledger).
--
-- Additive. Requires 20261008140000 (policy_snapshot) and 20261008150000 (carrier_retention_rule).
--
-- Rollback:
--   select cron.unschedule('la4-policy-current-daily');
--   drop function if exists public.refresh_policy_current_daily();
--   drop function if exists public.refresh_policy_current(uuid, uuid, text[], date);
--   drop table if exists public.policy_current;

create table if not exists public.policy_current (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  snapshot_id uuid not null references public.policy_snapshot(id) on delete cascade,
  -- the latest snapshot's values
  carrier_status_raw text,
  status_reported text,
  status_normalized text,
  paid_to_date date,
  effective_date date,
  issue_date date,
  application_date date,
  termination_date date,
  premium_cents bigint,
  premium_mode text,
  payment_method text,
  face_amount_cents bigint,
  product_code text,
  product_tier text,
  agent_identifier text,
  extra jsonb not null default '{}'::jsonb,
  -- our links
  contact_id uuid,
  household_id uuid,
  application_id uuid,
  case_id uuid,
  agent_user_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  lead_cost_cents bigint,
  -- computed
  as_of date not null,
  annualised_premium_cents bigint,
  days_past_due integer,
  retention_rule_id uuid,
  days_until_carrier_closes integer,
  months_paid integer,
  in_clawback_window boolean,
  total_advanced_cents bigint,
  total_earned_cents bigint,
  total_charged_back_cents bigint,
  unearned_advance_cents bigint,
  risk_band text not null,
  first_seen_date date not null,
  last_snapshot_date date not null,
  lapsed_on date,
  issued_on date,
  primary key (tenant_id, carrier_id, policy_number),
  constraint policy_current_status check (status_normalized is null or status_normalized in ('submitted', 'declined', 'withdrawn', 'approved_unpaid', 'not_taken', 'active', 'at_risk', 'lapsed', 'paid_up')),
  constraint policy_current_band check (risk_band in ('none', 'watch', 'at_risk', 'critical')),
  constraint policy_current_dpd check (days_past_due is null or days_past_due >= 0),
  constraint policy_current_dates check (last_snapshot_date >= first_seen_date)
);
create index if not exists policy_current_band_idx on public.policy_current (tenant_id, risk_band);
create index if not exists policy_current_status_idx on public.policy_current (tenant_id, status_normalized);
create index if not exists policy_current_carrier_idx on public.policy_current (carrier_id);
create index if not exists policy_current_snapshot_idx on public.policy_current (snapshot_id);
create index if not exists policy_current_closing_idx on public.policy_current (tenant_id, days_until_carrier_closes) where days_until_carrier_closes is not null;
create index if not exists policy_current_application_idx on public.policy_current (application_id) where application_id is not null;

-- Lookups the refresh makes: a status transition per policy, and a submission by policy number.
create index if not exists policy_change_status_idx on public.policy_change (tenant_id, carrier_id, policy_number, to_snapshot_date) where field_name = 'status_normalized';
create index if not exists tenant_application_submissions_policy_idx on public.tenant_application_submissions (tenant_id, carrier_id, policy_number) where policy_number is not null;

create or replace function public.refresh_policy_current(p_tenant_id uuid default null, p_carrier_id uuid default null, p_policy_numbers text[] default null, p_as_of date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_policy_numbers is not null and (p_tenant_id is null or p_carrier_id is null) then
    raise exception 'refresh_policy_current: a list of policies needs its agency and carrier' using errcode = '22023';
  end if;

  delete from public.policy_current pc
   where (p_tenant_id is null or pc.tenant_id = p_tenant_id)
     and (p_carrier_id is null or pc.carrier_id = p_carrier_id)
     and (p_policy_numbers is null or pc.policy_number = any (p_policy_numbers));

  insert into public.policy_current (
    tenant_id, agency_id, carrier_id, policy_number, snapshot_id,
    carrier_status_raw, status_reported, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date,
    premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier, extra,
    application_id, case_id, campaign_id, vendor_id,
    as_of, annualised_premium_cents, days_past_due, retention_rule_id, days_until_carrier_closes, months_paid, in_clawback_window,
    risk_band, first_seen_date, last_snapshot_date, lapsed_on, issued_on
  )
  with live as (
    select s.*
      from public.policy_snapshot s
     where not s.superseded
       and (p_tenant_id is null or s.tenant_id = p_tenant_id)
       and (p_carrier_id is null or s.carrier_id = p_carrier_id)
       and (p_policy_numbers is null or s.policy_number = any (p_policy_numbers))
  ),
  latest as (
    select distinct on (l.tenant_id, l.carrier_id, l.policy_number) l.*,
           min(l.snapshot_date) over (partition by l.tenant_id, l.carrier_id, l.policy_number) as first_seen
      from live l
     order by l.tenant_id, l.carrier_id, l.policy_number, l.snapshot_date desc, l.created_at desc
  ),
  -- Materialized: once per agency. Inlined, the timezone lookup ran for every policy, at every use
  -- of the date (29 s for 50,000 policies in the rehearsal).
  zones as materialized (
    select t.tenant_id,
           coalesce(p_as_of, (now() at time zone coalesce((select z.name from pg_timezone_names z where z.name = ap.timezone limit 1), 'UTC'))::date) as as_of
      from (select distinct tenant_id from latest) t
      left join public.agency_profiles ap on ap.tenant_id = t.tenant_id
  ),
  dated as (
    select l.*, z.as_of,
           case when l.paid_to_date is null then null else greatest(0, z.as_of - l.paid_to_date) end as dpd,
           case when l.paid_to_date is null or (l.effective_date is not null and l.paid_to_date <= l.effective_date) then 'first_payment' else 'ongoing_payment' end as rule_type,
           case when l.effective_date is null or l.paid_to_date is null then null
                when l.paid_to_date <= l.effective_date then 0
                else (extract(year from age(l.paid_to_date, l.effective_date)) * 12 + extract(month from age(l.paid_to_date, l.effective_date)))::integer end as months
      from latest l
      join zones z on z.tenant_id = l.tenant_id
  ),
  ruled as (
    select d.*,
           case when ag.id is not null and not ag.cleared then ag.id else pf.id end as rule_id,
           case when ag.id is not null and not ag.cleared then ag.window_days else pf.window_days end as window_days,
           case when ag.id is not null and not ag.cleared then ag.grace_days else pf.grace_days end as grace_days,
           adv.clawback_months
      from dated d
      left join lateral (
        select r.id, r.window_days, r.grace_days, r.cleared from public.carrier_retention_rule r
         where r.tenant_id = d.tenant_id and r.carrier_id = d.carrier_id and r.rule_type = d.rule_type and r.effective_from <= d.as_of
         order by r.effective_from desc, r.created_at desc limit 1
      ) ag on true
      left join lateral (
        select r.id, r.window_days, r.grace_days from public.carrier_retention_rule r
         where r.tenant_id is null and r.carrier_id = d.carrier_id and r.rule_type = d.rule_type and r.effective_from <= d.as_of
         order by r.effective_from desc, r.created_at desc limit 1
      ) pf on true
      left join lateral (
        select a.clawback_months from public.advance_rules a
         where a.tenant_id = d.tenant_id and a.carrier_id = d.carrier_id and a.product_code = d.product_code and a.effective_from <= d.as_of
         order by a.effective_from desc limit 1
      ) adv on true
  ),
  statused as (
    select r.*,
           case when r.status_normalized = 'active' and r.grace_days is not null and r.dpd is not null and r.dpd > r.grace_days then 'at_risk' else r.status_normalized end as status_eff
      from ruled r
  ),
  computed as (
    select s.*,
           case when s.status_eff in ('active', 'at_risk') and s.window_days is not null and s.dpd is not null then s.window_days - s.dpd end as until_closes,
           case when s.months is null or s.clawback_months is null then null else s.months < s.clawback_months end as in_clawback
      from statused s
  )
  select c.tenant_id, c.agency_id, c.carrier_id, c.policy_number, c.id,
         c.carrier_status_raw, c.status_normalized, c.status_eff, c.paid_to_date, c.effective_date, c.issue_date, c.application_date, c.termination_date,
         c.premium_cents, c.premium_mode, c.payment_method, c.face_amount_cents, c.product_code, c.product_tier, c.agent_identifier, c.extra,
         sub.application_id, app.case_id, cs.campaign_id, cs.vendor_id,
         c.as_of,
         c.premium_cents * case c.premium_mode when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 when 'annual' then 1 end,
         c.dpd, c.rule_id, c.until_closes, c.months, c.in_clawback,
         case when c.status_eff = 'at_risk' and (c.in_clawback is true or (c.until_closes is not null and c.until_closes <= 0)) then 'critical'
              when c.status_eff = 'at_risk' then 'at_risk'
              when c.status_eff = 'active' and coalesce(c.dpd, 0) > 0 then 'watch'
              else 'none' end,
         c.first_seen, c.snapshot_date,
         case when c.status_eff = 'lapsed' then (
           select max(pc.to_snapshot_date) from public.policy_change pc
            where pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
              and pc.field_name = 'status_normalized' and pc.new_value = 'lapsed') end,
         (select min(pc.to_snapshot_date) from public.policy_change pc
           where pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
             and pc.field_name = 'status_normalized' and pc.new_value = 'active' and pc.old_value in ('submitted', 'approved_unpaid'))
    from computed c
    left join lateral (
      select x.application_id from public.tenant_application_submissions x
       where x.tenant_id = c.tenant_id and x.carrier_id = c.carrier_id and x.policy_number = c.policy_number
       order by x.submitted_at desc, x.id limit 1
    ) sub on true
    left join public.tenant_applications app on app.id = sub.application_id
    left join public.tenant_application_cases cs on cs.id = app.case_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.refresh_policy_current(uuid, uuid, text[], date) from public, anon, authenticated;
grant execute on function public.refresh_policy_current(uuid, uuid, text[], date) to service_role;

-- The daily pass: every agency with snapshots, one agency per statement so each stays short.
create or replace function public.refresh_policy_current_daily()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_total integer := 0;
begin
  for v_tenant in select distinct s.tenant_id from public.policy_snapshot s where not s.superseded loop
    v_total := v_total + public.refresh_policy_current(v_tenant);
  end loop;
  -- An agency whose snapshots are all gone keeps no current rows.
  delete from public.policy_current pc where not exists (select 1 from public.policy_snapshot s where s.tenant_id = pc.tenant_id and not s.superseded);
  return v_total;
end;
$$;
revoke all on function public.refresh_policy_current_daily() from public, anon, authenticated;
grant execute on function public.refresh_policy_current_daily() to service_role;

alter table public.policy_current enable row level security;
drop policy if exists policy_current_read on public.policy_current;
create policy policy_current_read on public.policy_current for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.policy_current from public, anon, authenticated;
revoke insert, update, delete, truncate on public.policy_current from service_role, tenant_app;
grant select on public.policy_current to service_role, tenant_app;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-policy-current-daily', '15 6 * * *', $cron$select public.refresh_policy_current_daily()$cron$);
    exception when others then
      raise notice '20261008160000: the daily refresh could not be scheduled (%).', sqlerrm;
    end;
  else
    raise notice '20261008160000: pg_cron is not installed; run refresh_policy_current_daily() from another scheduler.';
  end if;
end $$;

-- Build it now, the way the job will (a job that fails at 06:15 fails silently), and check it.
do $$
declare
  v_rows integer;
  v_policies integer;
begin
  v_rows := public.refresh_policy_current_daily();
  select count(*) into v_policies from (select distinct tenant_id, carrier_id, policy_number from public.policy_snapshot where not superseded) p;
  if v_rows <> v_policies or (select count(*) from public.policy_current) <> v_policies then
    raise exception '20261008160000: policy_current has % rows for % policies', v_rows, v_policies;
  end if;
  if has_table_privilege('service_role', 'public.policy_current', 'INSERT') then
    raise exception '20261008160000: policy_current must be written only by refresh_policy_current';
  end if;
  if exists (select 1 from public.policy_current where days_until_carrier_closes is not null and retention_rule_id is null) then
    raise exception '20261008160000: a countdown without a carrier rule';
  end if;
end $$;
