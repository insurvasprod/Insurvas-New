-- LA-4 audit fix · an approved policy waiting for its first premium gets its countdown and band.
--
-- refresh_policy_current (live definition: 20261008300000) counted days late only from the paid-to
-- date and ran the carrier's countdown only for active / at_risk. An approved_unpaid policy — the
-- Module 4 doc's "danger zone" — so had no days late, no days until the carrier closes it and the
-- band 'none', even where the carrier's first-payment rule (LA-4.17) was set: the policy page said
-- "paid up to date" and the lapse-risk board filed it under "No carrier window configured".
--
-- Now, for approved_unpaid with nothing paid past the effective date:
--   · days late count from the effective date (the first draft is due then);
--   · days_until_carrier_closes = the first-payment rule's window − days late (rule_type is already
--     first_payment for such a row); no rule, still null — nothing invented;
--   · risk_band: critical once that window has run out, at_risk past the rule's grace, watch once late.
-- Every other status computes exactly as before. lib/ingestion/policyCurrent.ts holds the same
-- arithmetic (computeCurrent) and is tested against it.
--
-- The function is otherwise identical to 20261008300000. Agencies with an approved_unpaid policy are
-- rebuilt below (a full rebuild leaves the row count unchanged, checked); the rest follow at the
-- daily refresh, with nothing to change for them.
--
-- Rollback: re-run the refresh_policy_current definition from 20261008300000.
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
    contact_id, household_id, agent_user_id, application_id, case_id, campaign_id, vendor_id,
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
           -- 20261015520000: an approved policy whose first premium has not been drawn owes it on the
           -- effective date, so the first-payment window counts from there (lib/ingestion/policyCurrent.ts daysLate).
           case when l.status_normalized = 'approved_unpaid' and l.effective_date is not null and (l.paid_to_date is null or l.paid_to_date <= l.effective_date)
                  then greatest(0, z.as_of - l.effective_date)
                when l.paid_to_date is null then null else greatest(0, z.as_of - l.paid_to_date) end as dpd,
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
      -- Advance rules are keyed by our product family; the file names the carrier's own product. The
      -- agency's mapping wins over the platform's; with neither, the carrier's code as it is.
      left join lateral (
        select coalesce(
                 (select f.product_code from public.carrier_product_family f where f.tenant_id = d.tenant_id and f.carrier_id = d.carrier_id and f.carrier_product_code = d.product_code limit 1),
                 (select f.product_code from public.carrier_product_family f where f.tenant_id is null and f.carrier_id = d.carrier_id and f.carrier_product_code = d.product_code limit 1),
                 d.product_code) as family
      ) fam on true
      left join lateral (
        select a.clawback_months from public.advance_rules a
         where a.tenant_id = d.tenant_id and a.carrier_id = d.carrier_id and a.product_code = fam.family and a.effective_from <= d.as_of
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
           case when s.status_eff in ('active', 'at_risk', 'approved_unpaid') and s.window_days is not null and s.dpd is not null then s.window_days - s.dpd end as until_closes,
           case when s.months is null or s.clawback_months is null then null else s.months < s.clawback_months end as in_clawback
      from statused s
  )
  select c.tenant_id, c.agency_id, c.carrier_id, c.policy_number, c.id,
         c.carrier_status_raw, c.status_normalized, c.status_eff, c.paid_to_date, c.effective_date, c.issue_date, c.application_date, c.termination_date,
         c.premium_cents, c.premium_mode, c.payment_method, c.face_amount_cents, c.product_code, c.product_tier, c.agent_identifier, c.extra,
         pm.contact_id, ct.household_id, am.user_id, app.id, app.case_id, cs.campaign_id, cs.vendor_id,
         c.as_of,
         c.premium_cents * case c.premium_mode when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 when 'annual' then 1 end,
         c.dpd, c.rule_id, c.until_closes, c.months, c.in_clawback,
         case when c.status_eff = 'at_risk' and (c.in_clawback is true or (c.until_closes is not null and c.until_closes <= 0)) then 'critical'
              when c.status_eff = 'at_risk' then 'at_risk'
              when c.status_eff = 'approved_unpaid' and c.until_closes is not null and c.until_closes <= 0 then 'critical'
              when c.status_eff = 'approved_unpaid' and c.grace_days is not null and coalesce(c.dpd, 0) > c.grace_days then 'at_risk'
              when c.status_eff = 'approved_unpaid' and coalesce(c.dpd, 0) > 0 then 'watch'
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
    -- LA-4.8: the policy's current link gives the client; the carrier's exact agent string gives the agent.
    left join public.policy_match pm on pm.tenant_id = c.tenant_id and pm.carrier_id = c.carrier_id and pm.policy_number = c.policy_number and pm.superseded_by_id is null
    left join public.contacts ct on ct.id = pm.contact_id
    left join public.carrier_agent_map am on am.tenant_id = c.tenant_id and am.carrier_id = c.carrier_id and am.agent_identifier = c.agent_identifier
    left join public.tenant_applications app on app.id = coalesce(sub.application_id, case when pm.matched_to_type = 'application' then pm.matched_to_id end)
    left join public.tenant_application_cases cs on cs.id = app.case_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.refresh_policy_current(uuid, uuid, text[], date) from public, anon, authenticated;
grant execute on function public.refresh_policy_current(uuid, uuid, text[], date) to service_role;

-- Self-check: the new arithmetic is in, and a rebuild keeps every agency's row count.
do $$
declare
  v_def text := pg_get_functiondef('public.refresh_policy_current(uuid,uuid,text[],date)'::regprocedure);
  v_tenant uuid;
  v_before integer;
  v_after integer;
  v_rebuilt integer := 0;
begin
  if position('''active'', ''at_risk'', ''approved_unpaid''' in v_def) = 0 or position('greatest(0, z.as_of - l.effective_date)' in v_def) = 0 then
    raise exception '20261015520000: refresh_policy_current does not count down an approved, unpaid policy';
  end if;
  if position('carrier_product_family' in v_def) = 0 or position('carrier_agent_map am' in v_def) = 0 then
    raise exception '20261015520000: refresh_policy_current lost an earlier fix (product family, agent map)';
  end if;
  if has_function_privilege('anon', 'public.refresh_policy_current(uuid,uuid,text[],date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refresh_policy_current(uuid,uuid,text[],date)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.refresh_policy_current(uuid,uuid,text[],date)', 'EXECUTE') then
    raise exception '20261015520000: refresh_policy_current grants are wrong';
  end if;
  for v_tenant in select distinct pc.tenant_id from public.policy_current pc where pc.status_normalized = 'approved_unpaid' loop
    select count(*) into v_before from public.policy_current where tenant_id = v_tenant;
    perform public.refresh_policy_current(v_tenant);
    select count(*) into v_after from public.policy_current where tenant_id = v_tenant;
    if v_after <> v_before then
      raise exception '20261015520000: agency % had % current rows and now has %', v_tenant, v_before, v_after;
    end if;
    v_rebuilt := v_rebuilt + 1;
  end loop;
  raise notice '20261015520000: % agencies rebuilt', v_rebuilt;
end $$;
