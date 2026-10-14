-- LA-5.1 / LA-5.2 / LA-5.3 (Notion sprint, Module 5 — Retention) · the chargeback radar.
--
--   LA-5.1  policy_risk_signals   the seven risk signs per in-force policy, one row each, with the
--                                 ones we could not get NAMED in signals_missing_json. A missing sign
--                                 stays null — never a median, a zero or a "typical" value.
--   LA-5.2  risk_weight_set       versioned weights (platform default = version 1, tenant_id null).
--                                 A change is a new version; nothing is rewritten.
--           policy_risk_score     0–100, band, confidence, the contribution of every signal (the audit
--                                 trail) and the sentence the agent reads. Its own table: a prediction
--                                 is NEVER written to policy_current.risk_band (an observed fact).
--   LA-5.3  save_attempt          what the agent did on a save-queue card, with the score, band,
--                                 weight version and exposure AT THAT MOMENT (what LA-5.9 measures).
--                                 Never edited or removed.
--           save_queue_hold       snooze / dismiss, each with a reason.
--   LA-5.11 retention_settings    (the part 5.1–5.3 read) thresholds, cooldown, queue size, sample
--                                 floor, danger window, affordability bands; every change audited in
--                                 retention_setting_change.
--   LA-5.10 contact_income        the optional income figure Sign 5 reads (capture screens follow in
--                                 LA-5.10); on the contact, because income belongs to the person.
--
--   policy_payment_wobble(tenant, since, tolerance)   Sign 4 from LA-4.6's change log: a paid-to that
--                                 moved backwards, or that advanced after a file had already shown it
--                                 behind (stalled, then advanced). The carrier never reports either.
--
-- The signals and scores are DERIVED and written by the app (the draft-date optimiser of LA-3.9 is
-- TypeScript, and Sign 1 must call it, not reimplement it): after each policy file, and when a day
-- has passed since the last computation.
--
-- Additive. Requires 20261008160000 (policy_current) and 20261008150000 (carrier_retention_rule).
--
-- Rollback:
--   drop function if exists public.policy_payment_wobble(uuid, date, integer);
--   drop table if exists public.save_queue_hold, public.save_attempt, public.policy_risk_score,
--     public.policy_risk_signals, public.risk_weight_set, public.contact_income,
--     public.retention_setting_change, public.retention_settings;
--   drop function if exists public.risk_weight_set_guard(), public.save_attempt_guard();

-- ─── LA-5.11 · the settings 5.1–5.3 read ────────────────────────────────────────────────────────
create table if not exists public.retention_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Band cut points: low below medium_from, then medium / high / critical.
  medium_from smallint not null default 25,
  high_from smallint not null default 50,
  critical_from smallint not null default 75,
  -- The lowest band a card reaches the save queue at.
  queue_min_band text not null default 'high',
  include_medium_when_empty boolean not null default false,
  worked_cooldown_days smallint not null default 30,
  max_cards smallint not null default 100,
  -- Signals 6 and 7: below this many policies a figure is "unavailable", not "weak".
  sample_floor smallint not null default 20,
  -- Sign 3: policy months that score full points.
  danger_month_from smallint not null default 2,
  danger_month_to smallint not null default 5,
  -- Sign 5: premium as a share of monthly income, in basis points.
  affordability_low_bp integer not null default 300,
  affordability_high_bp integer not null default 600,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint retention_settings_bands check (medium_from between 1 and 98 and high_from > medium_from and critical_from > high_from and critical_from <= 99),
  constraint retention_settings_queue_band check (queue_min_band in ('medium', 'high', 'critical')),
  constraint retention_settings_cooldown check (worked_cooldown_days between 0 and 365),
  constraint retention_settings_cards check (max_cards between 10 and 500),
  constraint retention_settings_floor check (sample_floor between 5 and 500),
  constraint retention_settings_danger check (danger_month_from between 1 and 24 and danger_month_to between danger_month_from and 24),
  constraint retention_settings_afford check (affordability_low_bp between 1 and 5000 and affordability_high_bp > affordability_low_bp and affordability_high_bp <= 10000)
);

create table if not exists public.retention_setting_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  setting text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint retention_setting_change_setting check (char_length(setting) between 1 and 80)
);
create index if not exists retention_setting_change_tenant_idx on public.retention_setting_change (tenant_id, changed_at desc);
create index if not exists retention_setting_change_by_idx on public.retention_setting_change (changed_by) where changed_by is not null;

-- ─── LA-5.2 · versioned weights ─────────────────────────────────────────────────────────────────
create table if not exists public.risk_weight_set (
  id uuid primary key default gen_random_uuid(),
  -- null: the platform default every tenant starts on.
  tenant_id uuid references public.tenants(id) on delete cascade,
  version integer not null,
  weights jsonb not null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint risk_weight_set_version check (version > 0),
  constraint risk_weight_set_weights check (
    jsonb_typeof(weights) = 'object'
    and weights ?& array['draft_timing', 'payment_method', 'policy_age', 'payment_wobble', 'affordability', 'lead_source', 'carrier']
  ),
  constraint risk_weight_set_note check (note is null or char_length(note) <= 500)
);
create unique index if not exists risk_weight_set_version_idx on public.risk_weight_set (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
create index if not exists risk_weight_set_tenant_idx on public.risk_weight_set (tenant_id, version desc);
create index if not exists risk_weight_set_by_idx on public.risk_weight_set (created_by) where created_by is not null;

-- A weight set is history: scores point at it. A retune is a new version.
create or replace function public.risk_weight_set_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'A weight set is never edited or removed; save a new version.' using errcode = 'P0001';
end;
$$;
drop trigger if exists risk_weight_set_guard on public.risk_weight_set;
create trigger risk_weight_set_guard before update or delete on public.risk_weight_set
  for each row execute function public.risk_weight_set_guard();

insert into public.risk_weight_set (tenant_id, version, weights, note)
select null, 1,
       '{"draft_timing": 30, "payment_method": 20, "policy_age": 20, "payment_wobble": 15, "affordability": 10, "lead_source": 3, "carrier": 2}'::jsonb,
       'Platform starting weights (LA-5.2). Seeded, not final: tuned against LA-4.16 outcomes once enough exist.'
 where not exists (select 1 from public.risk_weight_set where tenant_id is null and version = 1);

-- ─── LA-5.10 · income, on the person ────────────────────────────────────────────────────────────
create table if not exists public.contact_income (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  monthly_income_cents bigint not null,
  income_type text,
  is_household_total boolean not null default false,
  source text not null,
  confidence text not null,
  captured_by uuid references public.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_income_amount check (monthly_income_cents > 0 and monthly_income_cents < 10000000),
  constraint contact_income_type check (income_type is null or income_type in ('ssa', 'ssi', 'pension', 'payroll', 'va', 'mixed', 'other')),
  constraint contact_income_source check (source in ('interview', 'draft_date_setup', 'retention_call', 'agent_estimate')),
  constraint contact_income_confidence check (confidence in ('stated', 'estimated')),
  constraint contact_income_estimate check (source <> 'agent_estimate' or confidence = 'estimated')
);
create index if not exists contact_income_tenant_idx on public.contact_income (tenant_id);
create index if not exists contact_income_by_idx on public.contact_income (captured_by) where captured_by is not null;

-- ─── LA-5.1 · the seven signals ─────────────────────────────────────────────────────────────────
create table if not exists public.policy_risk_signals (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  computed_at timestamptz not null default now(),
  -- The agency's day it was computed for (policy_current.as_of).
  as_of date not null,

  -- 1. draft vs income timing (LA-3.9's optimiser)
  draft_day smallint,
  expected_income_day smallint,
  income_type text,
  days_draft_before_income integer,
  recommended_draft_day smallint,
  recommended_draft_reason text,

  -- 2. payment method
  payment_method text,

  -- 3. months since issue
  months_since_issue integer,
  inside_clawback_window boolean,

  -- 4. payment wobble (LA-4.6's change log)
  draft_failures_count integer,
  last_failure_date date,
  recovered_after_failure boolean,
  wobble_detection_limited boolean not null default false,

  -- 5. affordability (LA-5.10)
  monthly_income_cents bigint,
  income_confidence text,
  premium_pct_of_income_bp integer,

  -- 6. lead source (LA-4.18)
  vendor_id uuid,
  campaign_id uuid,
  source_persistency_9mo_bp integer,
  tenant_persistency_9mo_bp integer,
  source_sample_size integer not null default 0,

  -- 7. carrier (LA-4.17)
  carrier_grace_days integer,
  carrier_redraft_attempts integer,
  carrier_lapse_rate_bp integer,
  carrier_sample_size integer not null default 0,

  signals_available smallint not null,
  signals_missing_json jsonb not null default '[]'::jsonb,
  primary key (tenant_id, carrier_id, policy_number),
  constraint policy_risk_signals_draft check (draft_day is null or draft_day between 1 and 31),
  constraint policy_risk_signals_rec check (recommended_draft_day is null or recommended_draft_day between 1 and 28),
  constraint policy_risk_signals_income_day check (expected_income_day is null or expected_income_day between 1 and 31),
  constraint policy_risk_signals_income_type check (income_type is null or income_type in ('ssa', 'ssi', 'ssa_ssi', 'pension', 'payroll', 'va', 'unknown')),
  constraint policy_risk_signals_method check (payment_method is null or payment_method in ('bank_draft', 'direct_express', 'card', 'direct_bill')),
  constraint policy_risk_signals_income_conf check (income_confidence is null or income_confidence in ('stated', 'estimated')),
  constraint policy_risk_signals_missing check (jsonb_typeof(signals_missing_json) = 'array'),
  -- "signals_available equals seven minus the missing ones, always."
  constraint policy_risk_signals_count check (signals_available between 0 and 7 and signals_available = 7 - jsonb_array_length(signals_missing_json))
);
create index if not exists policy_risk_signals_carrier_idx on public.policy_risk_signals (carrier_id);

-- ─── LA-5.2 · the score ─────────────────────────────────────────────────────────────────────────
create table if not exists public.policy_risk_score (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  score smallint not null,
  band text not null,
  signals_available smallint not null,
  available_weight smallint not null,
  confidence text not null,
  contributions_json jsonb not null,
  explanation text not null,
  weight_set_id uuid not null references public.risk_weight_set(id) on delete restrict,
  weight_set_version integer not null,
  as_of date not null,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id, policy_number),
  constraint policy_risk_score_score check (score between 0 and 100),
  constraint policy_risk_score_band check (band in ('low', 'medium', 'high', 'critical')),
  constraint policy_risk_score_conf check (confidence in ('high', 'medium', 'low')),
  constraint policy_risk_score_signals check (signals_available between 0 and 7),
  constraint policy_risk_score_weight check (available_weight between 0 and 100),
  constraint policy_risk_score_contrib check (jsonb_typeof(contributions_json) = 'array'),
  -- "A score with no usable sentence is a bug."
  constraint policy_risk_score_explanation check (char_length(btrim(explanation)) between 3 and 400)
);
create index if not exists policy_risk_score_band_idx on public.policy_risk_score (tenant_id, band, score desc);
create index if not exists policy_risk_score_carrier_idx on public.policy_risk_score (carrier_id);
create index if not exists policy_risk_score_weight_idx on public.policy_risk_score (weight_set_id);

-- ─── LA-5.3 · working the queue ─────────────────────────────────────────────────────────────────
create table if not exists public.save_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  risk_score_at_attempt smallint not null,
  band_at_attempt text not null,
  weight_set_version integer not null,
  unearned_advance_at_attempt_cents bigint,
  recommended_actions_json jsonb not null default '[]'::jsonb,
  action_taken text not null,
  contact_outcome text not null,
  -- LA-5.4's servicing request, when a fix was started (the reference arrives with 5.4).
  servicing_request_id uuid,
  attempted_by uuid references public.users(id) on delete set null,
  attempted_at timestamptz not null default now(),
  note text,
  in_holdout boolean not null default false,
  constraint save_attempt_score check (risk_score_at_attempt between 0 and 100),
  constraint save_attempt_band check (band_at_attempt in ('low', 'medium', 'high', 'critical')),
  constraint save_attempt_actions check (jsonb_typeof(recommended_actions_json) = 'array'),
  constraint save_attempt_action check (action_taken in ('none', 'move_draft_date', 'convert_to_draft', 'confirm_card_funded', 'confirm_account', 'review_coverage', 'courtesy_call')),
  constraint save_attempt_outcome check (contact_outcome in ('reached_agreed', 'reached_refused', 'voicemail', 'wrong_number', 'no_answer', 'already_fixed')),
  constraint save_attempt_note check (note is null or char_length(note) <= 2000)
);
create index if not exists save_attempt_policy_idx on public.save_attempt (tenant_id, carrier_id, policy_number, attempted_at desc);
create index if not exists save_attempt_recent_idx on public.save_attempt (tenant_id, attempted_at desc);
create index if not exists save_attempt_carrier_idx on public.save_attempt (carrier_id);
create index if not exists save_attempt_by_idx on public.save_attempt (attempted_by) where attempted_by is not null;

create or replace function public.save_attempt_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A save attempt is never removed.' using errcode = 'P0001';
  end if;
  -- The one move allowed: LA-5.4 linking the servicing request a fix started.
  if (to_jsonb(new) - 'servicing_request_id') is distinct from (to_jsonb(old) - 'servicing_request_id')
     or (old.servicing_request_id is not null and new.servicing_request_id is distinct from old.servicing_request_id) then
    raise exception 'A save attempt never changes; log another.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists save_attempt_guard on public.save_attempt;
create trigger save_attempt_guard before update or delete on public.save_attempt
  for each row execute function public.save_attempt_guard();

create table if not exists public.save_queue_hold (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  kind text not null,
  reason text not null,
  -- A snooze ends on this day; a dismissal has none and holds until released or the score rises.
  until_date date,
  score_at_hold smallint not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  constraint save_queue_hold_kind check (kind in ('snooze', 'dismiss')),
  constraint save_queue_hold_reason check (char_length(btrim(reason)) between 3 and 500),
  constraint save_queue_hold_until check ((kind = 'snooze') = (until_date is not null)),
  constraint save_queue_hold_score check (score_at_hold between 0 and 100)
);
create index if not exists save_queue_hold_open_idx on public.save_queue_hold (tenant_id, carrier_id, policy_number) where released_at is null;
create index if not exists save_queue_hold_carrier_idx on public.save_queue_hold (carrier_id);
create index if not exists save_queue_hold_by_idx on public.save_queue_hold (created_by) where created_by is not null;

-- ─── LA-5.1 · Sign 4 from the change log ────────────────────────────────────────────────────────
-- A failure is a paid-to that moved BACKWARDS (a reversed payment), or one that advanced when the
-- file before it already showed the policy more than p_tolerance days behind (stalled, then
-- advanced). Failures within 45 days of each other are one episode. Recovered: no reversal is left
-- without a later forward move.
create or replace function public.policy_payment_wobble(p_tenant_id uuid, p_since date, p_tolerance integer default 5)
returns table (carrier_id uuid, policy_number text, failures integer, last_failure_date date, recovered boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ch as (
    select c.carrier_id, c.policy_number, c.old_value::date as o, c.new_value::date as n, c.from_snapshot_date as f, c.to_snapshot_date as t
      from public.policy_change c
     where c.tenant_id = p_tenant_id
       and c.field_name = 'paid_to_date'
       and c.to_snapshot_date >= p_since
       and c.old_value ~ '^\d{4}-\d{2}-\d{2}$'
       and c.new_value ~ '^\d{4}-\d{2}-\d{2}$'
  ), ev as (
    select ch.carrier_id, ch.policy_number, ch.t,
           case when ch.n < ch.o then 'back' else 'late' end as kind
      from ch
     where ch.n < ch.o or (ch.n > ch.o and ch.o < ch.f - p_tolerance)
  ), ep as (
    select ev.carrier_id, ev.policy_number, ev.t, ev.kind,
           case when lag(ev.t) over w is null or ev.t - lag(ev.t) over w > 45 then 1 else 0 end as opens
      from ev
    window w as (partition by ev.carrier_id, ev.policy_number order by ev.t)
  ), fwd as (
    select ch.carrier_id, ch.policy_number, max(ch.t) as last_forward
      from ch where ch.n > ch.o
     group by ch.carrier_id, ch.policy_number
  )
  select ep.carrier_id, ep.policy_number, sum(ep.opens)::integer, max(ep.t),
         max(ep.t) filter (where ep.kind = 'back') is null
           or coalesce(max(fwd.last_forward) > max(ep.t) filter (where ep.kind = 'back'), false)
    from ep
    left join fwd on fwd.carrier_id = ep.carrier_id and fwd.policy_number = ep.policy_number
   group by ep.carrier_id, ep.policy_number;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['retention_settings', 'retention_setting_change', 'risk_weight_set', 'contact_income', 'policy_risk_signals', 'policy_risk_score', 'save_attempt', 'save_queue_hold'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    if t = 'risk_weight_set' then
      execute format('create policy %I on public.%I for select to tenant_app using (tenant_id is null or tenant_id = nullif((select current_setting(''app.tenant_id'', true)), '''')::uuid)', t || '_read', t);
    else
      execute format('create policy %I on public.%I for select to tenant_app using (tenant_id = nullif((select current_setting(''app.tenant_id'', true)), '''')::uuid)', t || '_read', t);
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to tenant_app', t);
  end loop;
end $$;

-- Derived rows: the app rebuilds them.
grant select, insert, update, delete on public.policy_risk_signals, public.policy_risk_score to service_role;
revoke truncate on public.policy_risk_signals, public.policy_risk_score from service_role, tenant_app;
revoke insert, update, delete, truncate on public.policy_risk_signals, public.policy_risk_score from tenant_app;
-- Settings: edited by the app, audited.
grant select, insert, update on public.retention_settings to service_role;
revoke delete, truncate on public.retention_settings from service_role, tenant_app;
revoke insert, update on public.retention_settings from tenant_app;
grant select, insert on public.retention_setting_change, public.risk_weight_set to service_role;
revoke update, delete, truncate on public.retention_setting_change, public.risk_weight_set from service_role, tenant_app;
revoke insert on public.retention_setting_change, public.risk_weight_set from tenant_app;
-- Income: written by the app, removable by a consumer deletion request.
grant select, insert, update, delete on public.contact_income to service_role;
revoke truncate on public.contact_income from service_role, tenant_app;
revoke insert, update, delete on public.contact_income from tenant_app;
-- What the agent did is a record. Only LA-5.4's link moves (the guard enforces which column).
grant select, insert, update on public.save_attempt to service_role;
revoke delete, truncate on public.save_attempt from service_role, tenant_app;
revoke insert, update on public.save_attempt from tenant_app;
-- Holds are released, never removed.
grant select, insert, update on public.save_queue_hold to service_role;
revoke delete, truncate on public.save_queue_hold from service_role, tenant_app;
revoke insert, update on public.save_queue_hold from tenant_app;

revoke all on function public.policy_payment_wobble(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.policy_payment_wobble(uuid, date, integer) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v integer;
begin
  if not exists (select 1 from public.risk_weight_set where tenant_id is null and version = 1) then
    raise exception '20261014100000: the platform weight set was not seeded';
  end if;
  select (select sum(value::int) from jsonb_each_text(weights)) into v from public.risk_weight_set where tenant_id is null and version = 1;
  if v <> 100 then
    raise exception '20261014100000: the platform weights sum to %, not 100', v;
  end if;
  perform count(*) from public.policy_payment_wobble('00000000-0000-0000-0000-000000000000'::uuid, current_date - 400, 5);
  if has_table_privilege('service_role', 'public.save_attempt', 'DELETE') or has_table_privilege('service_role', 'public.risk_weight_set', 'UPDATE')
     or has_table_privilege('service_role', 'public.risk_weight_set', 'DELETE') or has_table_privilege('service_role', 'public.retention_setting_change', 'UPDATE') then
    raise exception '20261014100000: records must not be editable (save_attempt delete=%, weight set update=%, weight set delete=%, setting change update=%)',
      has_table_privilege('service_role', 'public.save_attempt', 'DELETE'), has_table_privilege('service_role', 'public.risk_weight_set', 'UPDATE'),
      has_table_privilege('service_role', 'public.risk_weight_set', 'DELETE'), has_table_privilege('service_role', 'public.retention_setting_change', 'UPDATE');
  end if;
  if has_table_privilege('tenant_app', 'public.policy_risk_score', 'INSERT') or has_table_privilege('tenant_app', 'public.contact_income', 'SELECT') is not true then
    raise exception '20261014100000: tenant_app grants are wrong';
  end if;
end $$;
