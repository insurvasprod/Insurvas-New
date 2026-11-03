-- SA-2.4 · Plan pricing & billing cycle
--
-- One price row per plan VERSION. Because every version is its own `plans` row, grandfathering is
-- structural rather than something the billing code has to remember: changing a price creates a
-- new plan version with its own price row, and an existing subscriber keeps pointing at the old
-- one. SA-2.4's "changing a price does not change what any existing subscriber is billed" is
-- therefore enforced by the shape of the data, not by a rule somewhere.
--
-- Money is integer cents, checked in the database as well as in the application. SA-00 locks this:
-- "Money is integer cents. Never floats, never decimals." A `numeric` column here would be the
-- single easiest way to reintroduce rounding drift into every invoice downstream.
--
-- Delta from the Notion spec: the data block reads `plan_prices  plan_id, plan_version, …`. As
-- with plan_features, `plan_id` already identifies the version, and the declared type in
-- database.types.ts has no `plan_version`.
--
-- No prices are seeded. The three v1 plan codes are pinned by scripts/verify-entitlements.mjs and
-- so can be seeded with confidence; the amounts are not pinned anywhere, and SA-2.2 says plainly
-- that names and contents are "set by the business — do not hardcode them". Inventing figures
-- that checkout would later charge against is not a safe default.

create table if not exists public.plan_prices (
  plan_id                uuid primary key,
  currency               text not null default 'USD',
  price_monthly_cents    integer,
  price_quarterly_cents  integer,
  price_yearly_cents     integer,
  setup_fee_cents        integer not null default 0,
  trial_days             integer not null default 0,
  updated_at             timestamptz not null default now()
);

comment on table public.plan_prices is
  'SA-2.4 · Price for one plan version. A null cycle price means that cycle is simply not '
  'offered at checkout. One row per plan version; absence of a row means the plan is not yet '
  'priced and cannot be sold.';

comment on column public.plan_prices.setup_fee_cents is
  'One-time charge on the first invoice. Usually 0.';

comment on column public.plan_prices.trial_days is
  '0 means no trial. SA-00 locks card-required-at-signup with the charge deferred, so a trial '
  'length here is the deferral, not a free period without a card.';

do $$ begin
  alter table public.plan_prices
    add constraint plan_prices_plan_id_fkey foreign key (plan_id)
    references public.plans (id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- USD only, per the SA-00 declined list. A second currency is a decision, not a data entry.
do $$ begin
  alter table public.plan_prices add constraint plan_prices_currency_usd check (currency = 'USD');
exception when duplicate_object then null;
end $$;

-- Integer cents, never negative. A null price means "cycle not offered"; a negative one means a
-- bug that would bill a customer backwards.
do $$ begin
  alter table public.plan_prices add constraint plan_prices_non_negative check (
    coalesce(price_monthly_cents, 0) >= 0
    and coalesce(price_quarterly_cents, 0) >= 0
    and coalesce(price_yearly_cents, 0) >= 0
    and setup_fee_cents >= 0
    and trial_days >= 0
  );
exception when duplicate_object then null;
end $$;

-- A price row offering no cycle at all cannot be checked out against, and would fail silently at
-- the point of sale rather than at the point of configuration. A plan that is not yet priced has
-- no row here; a row means at least one way to buy it.
do $$ begin
  alter table public.plan_prices add constraint plan_prices_offers_a_cycle check (
    price_monthly_cents is not null
    or price_quarterly_cents is not null
    or price_yearly_cents is not null
  );
exception when duplicate_object then null;
end $$;

alter table public.plan_prices enable row level security;

drop policy if exists plan_prices_service_role_only on public.plan_prices;
create policy plan_prices_service_role_only on public.plan_prices
  for all to service_role using (true) with check (true);

revoke all on public.plan_prices from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.plan_prices to service_role;
