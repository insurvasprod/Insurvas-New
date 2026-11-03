-- Give the three published plans a price, so anything can be sold at all.
--
-- public.plan_prices holds zero rows while plans, plan_limits, plan_features and features are all
-- populated. A plan with no price row cannot be bought: /api/public/signup resolves the plan and
-- then the billing cycle, and answers
--
--   400 That plan or billing cycle is no longer available
--
-- for every request. Self-serve signup is therefore closed, and SA-5.2 checkout, SA-5.3 trials and
-- SA-2.7 subscription transitions all fail behind it.
--
-- How it came to be empty, because the mechanism matters more than the missing rows. The prices are
-- declared in 20260831065500_seed_individual_agent_catalog.sql as
--
--   insert into public.plan_prices (...)
--   select p.id, v.monthly, null, v.yearly, 0, 14, 'USD'
--   from public.plans p
--   join (values ('basic', 9900, 99000), ...) as v(code, monthly, yearly) on v.code = p.code;
--
-- an INSERT ... SELECT whose join finds nothing when the plans do not exist yet. It inserts zero
-- rows and succeeds. The plans in this database were created on 2026-09-11 by the SA-2 migrations,
-- months after that seed's own date, so the seed ran against an empty `plans` table and silently
-- did nothing. Its sibling statements for plan_limits and plan_features are shaped the same way and
-- happen to be populated, which is why the gap looked like it could not exist.
--
-- 20260911133000_sa_2_4_plan_prices.sql, which owns this table under SA-2, declares the structure
-- and inserts no rows at all. Neither file is wrong on its own; between them nobody priced anything.
--
-- The numbers are not invented here. They are the ones already declared in the seed migration, with
-- its own stated rule: "Yearly is ten months for twelve, matching the admin doc's own example (a
-- $449 plan priced at $4,490 a year). Quarterly is deliberately null — a cycle with no price cannot
-- be sold." basic 99.00, pro 249.00, advance 449.00 monthly. If those are no longer the intended
-- prices, this is the file to change before anyone is charged.
--
-- Idempotent and non-destructive: plan_prices is keyed by plan_id, and an existing row is left
-- exactly as it is rather than overwritten, so re-running cannot reprice a plan somebody already
-- bought. Only plans that have no price row at all are given one.

insert into public.plan_prices (
  plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents,
  setup_fee_cents, trial_days, currency
)
select p.id, v.monthly, null, v.yearly, 0, 14, 'USD'
from public.plans p
join (values
  ('basic',    9900,  99000),
  ('pro',     24900, 249000),
  ('advance', 44900, 449000)
) as v(code, monthly, yearly) on v.code = p.code
on conflict (plan_id) do nothing;

-- The seed above is the same INSERT ... SELECT shape that silently did nothing before, so assert
-- the outcome rather than assuming it. A plan that is public and sellable must now have a price.
do $$
declare
  unpriced integer;
begin
  select count(*) into unpriced
  from public.plans p
  where p.is_public
    and not coalesce(p.is_archived, false)
    and not exists (select 1 from public.plan_prices pp where pp.plan_id = p.id);

  if unpriced > 0 then
    raise exception 'plan_prices backfill left % public plan(s) unpriced', unpriced;
  end if;
end;
$$;
