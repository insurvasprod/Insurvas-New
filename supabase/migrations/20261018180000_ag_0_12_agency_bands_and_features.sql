-- AG-0.12 (Notion sprint, Agency Module 0) · retire the per-seat agency plan; seat bands and the agency features.
--
-- Two agency price ladders were written into the specs and they contradicted each other. The flat band wins:
--   agency_50         1–50 seats     $999 / month
--   agency_150        51–150 seats   $2,499 / month
--   agency_unlimited  151+ seats     $4,999 / month
-- Each is a plan with plan_type agency_with_teams (so its audience is 'agency', AG-0.1) and max_seats 50 / 150 /
-- unlimited: the one seat check LA-8.6 already runs IS the band check (AG-0.6). A band upgrade is immediate and
-- prorated against the price difference; a downgrade takes effect at period end with no refund — SA-3's plan-
-- change rules, unchanged (lib/subscriptions/proration.ts).
--
-- What dies: the $799 + $79/seat plan, extra_seat_cents (4900) and assistant_seat_cents (2900). None of the three
-- exists in this database (checked 2026-10-18: no plan priced 79900, no such columns); this file asserts that
-- they never appear. Their mentions in the Notion specs are the owner's to strike.
--
-- Feature keys (SA-2 catalogue), module 'agency':
--   team_hierarchy       Producers, hierarchy & overrides        (already promised by SA doc §4.1)
--   producer_scorecards  Producer scorecards                     (already promised)
--   team_qa              Application review                      (already promised; never called "QA" on screen)
--   producer_payouts     Producer payout runs & statements       (new)
--   lead_assignment      Lead routing to producers               (new)
--   agency_dashboard     Agency owner dashboard                  (new)
-- Each has exactly one requireFeature guard and one menu node (npm run check:features).
-- Granted to the three band plans and to every other agency-typed plan (the private QA agency plans).
--
-- Rollback: delete from plan_features where feature_key in (…six…); update plans set is_archived = true where
--   code in ('agency_50','agency_150','agency_unlimited'); update features set is_archived = true where feature_key in (…).

insert into public.features (feature_key, label, module, sort_order) values
  ('agency_dashboard',    'Agency owner dashboard',              'agency', 1),
  ('team_hierarchy',      'Producers, hierarchy & overrides',    'agency', 2),
  ('lead_assignment',     'Lead routing to producers',           'agency', 3),
  ('producer_payouts',    'Producer payout runs & statements',   'agency', 4),
  ('producer_scorecards', 'Producer scorecards',                 'agency', 5),
  ('team_qa',             'Application review',                  'agency', 6)
on conflict (feature_key) do update set label = excluded.label, module = excluded.module, is_archived = false;

-- ─── the three bands ──────────────────────────────────────────────────────────────────────────────
insert into public.plans (code, version, name, plan_type, description, is_public, is_archived, sort_order)
values
  ('agency_50',        1, 'Agency · 1–50 seats',   'agency_with_teams', 'Everything in Advanced for a team of up to 50, flat.',   true, false, 10),
  ('agency_150',       1, 'Agency · 51–150 seats', 'agency_with_teams', 'Everything in Advanced for a team of up to 150, flat.',  true, false, 11),
  ('agency_unlimited', 1, 'Agency · 151+ seats',   'agency_with_teams', 'Everything in Advanced for a team of 151 or more, flat.', true, false, 12)
on conflict (code, version) do nothing;

insert into public.plan_prices (plan_id, currency, price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days)
select p.id, 'USD', v.cents, null, null, 0, 14
  from public.plans p
  join (values ('agency_50', 99900), ('agency_150', 249900), ('agency_unlimited', 499900)) v(code, cents) on v.code = p.code
 where p.version = 1
on conflict (plan_id) do update set price_monthly_cents = excluded.price_monthly_cents;

insert into public.plan_limits (plan_id, max_seats)
select p.id, v.seats
  from public.plans p
  join (values ('agency_50', 50), ('agency_150', 150), ('agency_unlimited', null::integer)) v(code, seats) on v.code = p.code
 where p.version = 1
on conflict (plan_id) do update set max_seats = excluded.max_seats;

-- Everything the most complete individual plan has (the product the producers log into), on every band.
insert into public.plan_features (plan_id, feature_key)
select b.id, pf.feature_key
  from public.plans b
  join public.plans adv on adv.code = 'advance'
  join public.plan_features pf on pf.plan_id = adv.id
 where b.code in ('agency_50', 'agency_150', 'agency_unlimited')
on conflict do nothing;

-- The six agency features, on every agency-typed plan.
insert into public.plan_features (plan_id, feature_key)
select p.id, f.feature_key
  from public.plans p
  cross join (values ('agency_dashboard'), ('team_hierarchy'), ('lead_assignment'), ('producer_payouts'), ('producer_scorecards'), ('team_qa')) f(feature_key)
 where p.plan_type::text in ('agency_no_teams', 'agency_with_teams')
on conflict do nothing;

-- Entitlements are cached per tenant: refresh the agency-typed ones so the new features reach them now.
do $$
declare
  v_tenant uuid;
begin
  if to_regproc('public.refresh_tenant_entitlement') is null then return; end if;
  for v_tenant in select t.id from public.tenants t where public.tenant_plan_audience(t.id) = 'agency' loop
    perform public.refresh_tenant_entitlement(v_tenant);
  end loop;
end;
$$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.plan_prices pp join public.plans p on p.id = pp.plan_id
              where p.plan_type::text like 'agency%' and p.is_public and pp.price_monthly_cents = 79900) then
    raise exception 'AG-0.12: the $799 per-seat agency plan is still on sale';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in ('extra_seat_cents', 'assistant_seat_cents')) then
    raise exception 'AG-0.12: a per-seat price column still exists';
  end if;
  if (select count(*) from public.plans where code in ('agency_50', 'agency_150', 'agency_unlimited') and plan_type::text = 'agency_with_teams') <> 3 then
    raise exception 'AG-0.12: the three bands are not all agency plans';
  end if;
end;
$$;
