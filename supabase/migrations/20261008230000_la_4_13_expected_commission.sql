-- LA-4.13 (Notion sprint) · expected commission: what the agent SHOULD have been paid.
--
-- The rate card is LA-0.4's commission_schedules (carrier, product family, contract level, policy
-- year, effective date). This adds the three things it lacks:
--
--   commission_schedule_band   an age band on a schedule row: a different rate for issue ages
--                              age_min..age_max. A child table rather than columns, so the existing
--                              unique key and save_commission_schedule keep working unchanged.
--   carrier_product_family     a carrier's own product code (what its files say: "CCI", "FE Level")
--                              → our product family (products.code), which the rate card is keyed
--                              by. Platform rows (tenant null) and an agency's own, which win.
--   expected_commission        one row per policy and policy year, written once the carrier's pay
--                              trigger has occurred (on issue, or on the first draft):
--                              confidence exact | assumed_level | no_rate_card. A row with a figure
--                              is never rewritten (rates are forward-only); a no_rate_card row holds
--                              no figure and is filled in when a rate is entered.
--
-- The trigger and the lag already live on LA-4.17's carrier_operating_settings; this seeds the
-- platform's trigger for the carriers of the Module 4 list that are in the library.
--
-- Additive. Requires 20261008150000 (carrier_operating_settings), 20261008160000 (policy_current).
--
-- Rollback:
--   drop function if exists public.record_expected_commission(uuid, jsonb);
--   drop table if exists public.expected_commission, public.carrier_product_family, public.commission_schedule_band;

-- ─── age bands ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.commission_schedule_band (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.commission_schedules(id) on delete cascade,
  age_min smallint not null,
  age_max smallint not null,
  rate_bp integer not null,
  created_at timestamptz not null default now(),
  constraint commission_schedule_band_ages check (age_min between 0 and 120 and age_max between 0 and 120 and age_min <= age_max),
  constraint commission_schedule_band_rate check (rate_bp between 0 and 1000000)
);
create index if not exists commission_schedule_band_schedule_idx on public.commission_schedule_band (schedule_id, age_min);
-- Two bands of one schedule row never overlap.
create or replace function public.commission_schedule_band_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.commission_schedule_band b
              where b.schedule_id = new.schedule_id and b.id <> new.id
                and int4range(b.age_min, b.age_max, '[]') && int4range(new.age_min, new.age_max, '[]')) then
    raise exception 'Age bands of one rate cannot overlap (% to %).', new.age_min, new.age_max using errcode = '23P01';
  end if;
  return new;
end;
$$;
drop trigger if exists commission_schedule_band_guard on public.commission_schedule_band;
create trigger commission_schedule_band_guard before insert or update on public.commission_schedule_band
  for each row execute function public.commission_schedule_band_guard();

-- ─── carrier product code → product family ──────────────────────────────────────────────────────
create table if not exists public.carrier_product_family (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_product_code text not null,
  product_code text not null references public.products(code) on update cascade on delete restrict,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint carrier_product_family_code check (char_length(carrier_product_code) between 1 and 120)
);
create unique index if not exists carrier_product_family_key on public.carrier_product_family (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), carrier_id, carrier_product_code);
create index if not exists carrier_product_family_tenant_idx on public.carrier_product_family (tenant_id);
create index if not exists carrier_product_family_carrier_idx on public.carrier_product_family (carrier_id);
create index if not exists carrier_product_family_product_idx on public.carrier_product_family (product_code);
create index if not exists carrier_product_family_updated_by_idx on public.carrier_product_family (updated_by) where updated_by is not null;

-- ─── expected commission ────────────────────────────────────────────────────────────────────────
create table if not exists public.expected_commission (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  policy_year integer not null default 1,
  commission_trigger text not null,
  trigger_occurred_on date not null,
  overdue_from date,
  confidence text not null,
  reason text,
  product_family text references public.products(code) on update cascade on delete restrict,
  contract_level_bp integer,
  issue_age smallint,
  schedule_id uuid references public.commission_schedules(id) on delete set null,
  schedule_version date,
  band_id uuid references public.commission_schedule_band(id) on delete set null,
  rate_bp_applied integer,
  commissionable_premium_cents bigint,
  expected_amount_cents bigint,
  advance_months integer,
  advance_pct_bp integer,
  expected_advance_cents bigint,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id, policy_number, policy_year),
  constraint expected_commission_trigger check (commission_trigger in ('on_issue', 'on_first_draft')),
  constraint expected_commission_confidence check (confidence in ('exact', 'assumed_level', 'no_rate_card')),
  -- No rate card: no figure at all. Never a zero standing in for "unknown".
  constraint expected_commission_figure check (
    (confidence = 'no_rate_card' and expected_amount_cents is null and rate_bp_applied is null and reason is not null)
    or (confidence <> 'no_rate_card' and expected_amount_cents is not null and rate_bp_applied is not null and schedule_id is not null and schedule_version is not null)
  ),
  constraint expected_commission_overdue check (overdue_from is null or overdue_from >= trigger_occurred_on),
  constraint expected_commission_year check (policy_year between 1 and 50)
);
create index if not exists expected_commission_overdue_idx on public.expected_commission (tenant_id, overdue_from);
create index if not exists expected_commission_carrier_idx on public.expected_commission (carrier_id);
create index if not exists expected_commission_schedule_idx on public.expected_commission (schedule_id) where schedule_id is not null;
create index if not exists expected_commission_band_idx on public.expected_commission (band_id) where band_id is not null;
create index if not exists expected_commission_product_idx on public.expected_commission (product_family) where product_family is not null;

-- Forward-only: a row with a figure is what was expected when it was computed, and is never
-- rewritten or removed. A no_rate_card row (no figure) may be filled in once.
create or replace function public.expected_commission_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'An expected commission row is never removed.' using errcode = 'P0001';
  end if;
  if old.confidence <> 'no_rate_card' then
    raise exception 'An expected commission figure is never rewritten; a rate change applies to later rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists expected_commission_guard on public.expected_commission;
create trigger expected_commission_guard before update or delete on public.expected_commission
  for each row execute function public.expected_commission_guard();

-- The only writer. p_rows: [{ carrier_id, policy_number, policy_year, commission_trigger,
-- trigger_occurred_on, overdue_from, confidence, reason, product_family, contract_level_bp,
-- issue_age, schedule_id, schedule_version, band_id, rate_bp_applied, commissionable_premium_cents,
-- expected_amount_cents, advance_months, advance_pct_bp, expected_advance_cents }]
create or replace function public.record_expected_commission(p_tenant_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_filled integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'record_expected_commission: rows must be an array' using errcode = '22023';
  end if;
  with incoming as (
    select r.* from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      carrier_id uuid, policy_number text, policy_year integer, commission_trigger text, trigger_occurred_on date, overdue_from date,
      confidence text, reason text, product_family text, contract_level_bp integer, issue_age smallint, schedule_id uuid,
      schedule_version date, band_id uuid, rate_bp_applied integer, commissionable_premium_cents bigint, expected_amount_cents bigint,
      advance_months integer, advance_pct_bp integer, expected_advance_cents bigint)
     -- Only for policies this agency holds.
     where exists (select 1 from public.policy_current pc where pc.tenant_id = p_tenant_id and pc.carrier_id = r.carrier_id and pc.policy_number = r.policy_number)
  ), ins as (
    insert into public.expected_commission (tenant_id, carrier_id, policy_number, policy_year, commission_trigger, trigger_occurred_on,
      overdue_from, confidence, reason, product_family, contract_level_bp, issue_age, schedule_id, schedule_version, band_id,
      rate_bp_applied, commissionable_premium_cents, expected_amount_cents, advance_months, advance_pct_bp, expected_advance_cents)
    select p_tenant_id, i.carrier_id, i.policy_number, coalesce(i.policy_year, 1), i.commission_trigger, i.trigger_occurred_on,
      i.overdue_from, i.confidence, i.reason, i.product_family, i.contract_level_bp, i.issue_age, i.schedule_id, i.schedule_version, i.band_id,
      i.rate_bp_applied, i.commissionable_premium_cents, i.expected_amount_cents, i.advance_months, i.advance_pct_bp, i.expected_advance_cents
      from incoming i
    on conflict (tenant_id, carrier_id, policy_number, policy_year) do update set
      commission_trigger = excluded.commission_trigger, trigger_occurred_on = excluded.trigger_occurred_on, overdue_from = excluded.overdue_from,
      confidence = excluded.confidence, reason = excluded.reason, product_family = excluded.product_family, contract_level_bp = excluded.contract_level_bp,
      issue_age = excluded.issue_age, schedule_id = excluded.schedule_id, schedule_version = excluded.schedule_version, band_id = excluded.band_id,
      rate_bp_applied = excluded.rate_bp_applied, commissionable_premium_cents = excluded.commissionable_premium_cents,
      expected_amount_cents = excluded.expected_amount_cents, advance_months = excluded.advance_months, advance_pct_bp = excluded.advance_pct_bp,
      expected_advance_cents = excluded.expected_advance_cents, computed_at = now()
      -- Forward-only: only a row without a figure is touched, and only by a change.
      where expected_commission.confidence = 'no_rate_card'
        and (excluded.confidence <> 'no_rate_card' or excluded.reason is distinct from expected_commission.reason)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_filled from ins;
  return jsonb_build_object('inserted', v_inserted, 'filled', v_filled);
end;
$$;

-- ─── the platform's pay triggers (Module 4 list; carriers in the library) ──────────────────────
-- Lags are left empty where nothing measured them, so nothing is called overdue on a guess. Aetna's
-- 10 days is the weekly-Friday statement plus a week, Americo's 35 a monthly statement (carrier
-- knowledge, docs/la4/CARRIER-KNOWLEDGE.md). An agency's own setting overrides these.
insert into public.carrier_operating_settings (tenant_id, carrier_id, commission_trigger, expected_lag_days)
select null, c.id, s.trigger_kind, s.lag
  from (values ('americo', 'on_issue', 35), ('mutual_of_omaha', 'on_issue', null::integer),
               ('aetna', 'on_first_draft', 10), ('transamerica', 'on_first_draft', null::integer)) as s(code, trigger_kind, lag)
  join public.carriers c on c.code = s.code
 where not exists (select 1 from public.carrier_operating_settings o where o.tenant_id is null and o.carrier_id = c.id);

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.commission_schedule_band enable row level security;
alter table public.carrier_product_family enable row level security;
alter table public.expected_commission enable row level security;
drop policy if exists commission_schedule_band_read on public.commission_schedule_band;
create policy commission_schedule_band_read on public.commission_schedule_band for select to tenant_app
  using (exists (select 1 from public.commission_schedules s where s.id = schedule_id and s.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
drop policy if exists carrier_product_family_read on public.carrier_product_family;
create policy carrier_product_family_read on public.carrier_product_family for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists expected_commission_read on public.expected_commission;
create policy expected_commission_read on public.expected_commission for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.commission_schedule_band, public.carrier_product_family, public.expected_commission from public, anon, authenticated;
revoke truncate on public.commission_schedule_band, public.carrier_product_family from service_role, tenant_app;
-- Supabase grants service_role everything on a new table: expected rows are written only by the function.
revoke insert, update, delete, truncate on public.expected_commission from service_role, tenant_app;
grant select, insert, update, delete on public.commission_schedule_band, public.carrier_product_family to service_role;
grant select on public.commission_schedule_band, public.carrier_product_family, public.expected_commission to service_role, tenant_app;
revoke all on function public.record_expected_commission(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_expected_commission(uuid, jsonb) to service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.expected_commission', 'INSERT') or has_table_privilege('service_role', 'public.expected_commission', 'UPDATE')
     or has_table_privilege('service_role', 'public.expected_commission', 'DELETE') then
    raise exception '20261008230000: expected commission must be written only by record_expected_commission (service_role still has insert=%, update=%, delete=%)',
      has_table_privilege('service_role', 'public.expected_commission', 'INSERT'), has_table_privilege('service_role', 'public.expected_commission', 'UPDATE'),
      has_table_privilege('service_role', 'public.expected_commission', 'DELETE');
  end if;
end $$;
