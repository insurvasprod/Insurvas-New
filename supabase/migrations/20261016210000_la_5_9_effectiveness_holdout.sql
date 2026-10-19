-- LA-5.9 (Notion sprint, Module 5 — Retention) · are the predictions any good, and does working the
-- queue save policies?
--
--   prediction_outcome  Part 1. A policy's score is recorded once per horizon (90 days by default),
--                       and the look at what happened is taken when the horizon passes. Written by the
--                       app's radar run; the outcome is filled in once and never changed.
--   retention_holdout   Part 2. Every policy that crosses the save-queue threshold while the holdout is
--                       on gets one draw. The selected few are kept off the queue; the rest are worked
--                       as usual. A draw is never removed, its selection never flips, and it can only
--                       be LEFT (past due, the holdout switched off, the policy left the book) and
--                       RESOLVED (the outcome at the horizon).
--   retention_settings  holdout_enabled (OFF by default), holdout_share_bp (10%, platform ceiling
--                       20% enforced here as well as in the app), holdout_max_exposure_cents (a
--                       policy with more advance at risk is never held out), prediction_horizon_days.
--
-- The safeguards the database itself holds:
--   · a draw cannot be selected above the 20% ceiling, nor with exposure above its threshold or unknown;
--   · a policy with an open reinstatement case is never selected (that deadline is permanent);
--   · a selected draw cannot be un-selected, and a draw is never deleted.
-- Leaving on past due is the app's radar run (it reads the same policy_current row the LA-4.16 board
-- reads, after every policy file).
--
-- Additive. Requires 20261014100000 (retention_settings) and 20261014400000 (reinstatement_case).
--
-- Rollback:
--   drop table if exists public.retention_holdout, public.prediction_outcome;
--   drop function if exists public.retention_holdout_guard(), public.prediction_outcome_guard();
--   alter table public.retention_settings drop column if exists holdout_enabled, drop column if exists holdout_share_bp,
--     drop column if exists holdout_max_exposure_cents, drop column if exists prediction_horizon_days;

alter table public.retention_settings add column if not exists holdout_enabled boolean not null default false;
alter table public.retention_settings add column if not exists holdout_share_bp smallint not null default 1000;
alter table public.retention_settings add column if not exists holdout_max_exposure_cents bigint not null default 100000;
alter table public.retention_settings add column if not exists prediction_horizon_days smallint not null default 90;
alter table public.retention_settings drop constraint if exists retention_settings_holdout;
alter table public.retention_settings add constraint retention_settings_holdout check (
  holdout_share_bp between 100 and 2000
  and holdout_max_exposure_cents between 0 and 100000000
  and prediction_horizon_days between 30 and 365
);

-- ─── Part 1 · the score, then what happened ─────────────────────────────────────────────────────
create table if not exists public.prediction_outcome (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  scored_on date not null,
  score smallint not null,
  band text not null,
  confidence text not null,
  weight_set_version integer not null,
  signals_available smallint not null,
  horizon_days smallint not null,
  outcome_at_horizon text,
  was_worked boolean,
  in_holdout boolean,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prediction_outcome_score check (score between 0 and 100),
  constraint prediction_outcome_band check (band in ('low', 'medium', 'high', 'critical')),
  constraint prediction_outcome_conf check (confidence in ('high', 'medium', 'low')),
  constraint prediction_outcome_signals check (signals_available between 0 and 7),
  constraint prediction_outcome_horizon check (horizon_days between 30 and 365),
  constraint prediction_outcome_outcome check (outcome_at_horizon is null or outcome_at_horizon in ('still_active', 'lapsed', 'paid_up', 'reinstated')),
  constraint prediction_outcome_resolved check ((outcome_at_horizon is null) = (resolved_at is null) and (resolved_at is null or (was_worked is not null and in_holdout is not null))),
  constraint prediction_outcome_key unique (tenant_id, carrier_id, policy_number, scored_on)
);
create index if not exists prediction_outcome_open_idx on public.prediction_outcome (tenant_id, scored_on) where resolved_at is null;
create index if not exists prediction_outcome_report_idx on public.prediction_outcome (tenant_id, resolved_at desc) where resolved_at is not null;
create index if not exists prediction_outcome_carrier_idx on public.prediction_outcome (carrier_id);

-- A prediction is history: only its resolution is ever written, once.
create or replace function public.prediction_outcome_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- A cancelled agency's workspace purge (20261016430000) passes; nothing else does. Looked up at run
  -- time, so this file can be applied before or after that one.
  if tg_op = 'DELETE' and tg_level = 'ROW' and to_regprocedure('public.tenant_purge_active(jsonb)') is not null then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A recorded prediction is never removed.' using errcode = 'P0001';
  end if;
  if old.resolved_at is not null then
    raise exception 'A resolved prediction never changes.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['outcome_at_horizon', 'was_worked', 'in_holdout', 'resolved_at']) is distinct from (to_jsonb(old) - array['outcome_at_horizon', 'was_worked', 'in_holdout', 'resolved_at']) then
    raise exception 'Only the outcome of a prediction is written; the prediction itself never changes.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists prediction_outcome_guard on public.prediction_outcome;
create trigger prediction_outcome_guard before update or delete on public.prediction_outcome
  for each row execute function public.prediction_outcome_guard();

-- ─── Part 2 · the holdout ───────────────────────────────────────────────────────────────────────
create table if not exists public.retention_holdout (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  drawn_on date not null,
  band_at_draw text not null,
  score_at_draw smallint not null,
  confidence_at_draw text not null,
  weight_set_version integer not null,
  exposure_cents bigint,
  share_bp smallint not null,
  max_exposure_cents bigint not null,
  selected boolean not null,
  -- Why a draw could not be selected whatever the roll: its exposure.
  ineligible_reason text,
  horizon_days smallint not null,
  left_at timestamptz,
  left_reason text,
  outcome_at_horizon text,
  was_worked boolean,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint retention_holdout_band check (band_at_draw in ('low', 'medium', 'high', 'critical')),
  constraint retention_holdout_score check (score_at_draw between 0 and 100),
  constraint retention_holdout_conf check (confidence_at_draw in ('high', 'medium', 'low')),
  -- The platform ceiling, held here too: a misconfiguration cannot withhold most of the queue.
  constraint retention_holdout_share check (share_bp between 100 and 2000),
  constraint retention_holdout_ineligible check (ineligible_reason is null or ineligible_reason in ('above_exposure', 'exposure_unknown')),
  -- Never the biggest cases, and never one whose exposure is not known.
  constraint retention_holdout_exposure check (not selected or (exposure_cents is not null and exposure_cents <= max_exposure_cents and ineligible_reason is null)),
  constraint retention_holdout_horizon check (horizon_days between 30 and 365),
  constraint retention_holdout_left check ((left_at is null) = (left_reason is null) and (left_reason is null or left_reason in ('past_due', 'switched_off', 'left_book'))),
  constraint retention_holdout_left_selected check (left_at is null or selected),
  constraint retention_holdout_outcome check (outcome_at_horizon is null or outcome_at_horizon in ('still_active', 'lapsed', 'paid_up', 'reinstated')),
  constraint retention_holdout_resolved check ((outcome_at_horizon is null) = (resolved_at is null) and (resolved_at is null or was_worked is not null)),
  constraint retention_holdout_key unique (tenant_id, carrier_id, policy_number, drawn_on)
);
create index if not exists retention_holdout_open_idx on public.retention_holdout (tenant_id, carrier_id, policy_number) where selected and left_at is null;
create index if not exists retention_holdout_recent_idx on public.retention_holdout (tenant_id, carrier_id, policy_number, drawn_on desc);
create index if not exists retention_holdout_unresolved_idx on public.retention_holdout (tenant_id, drawn_on) where resolved_at is null;
create index if not exists retention_holdout_carrier_idx on public.retention_holdout (carrier_id);

create or replace function public.retention_holdout_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fixed text[] := array['left_at', 'left_reason', 'outcome_at_horizon', 'was_worked', 'resolved_at'];
begin
  -- A cancelled agency's workspace purge (20261016430000) passes; nothing else does. Looked up at run
  -- time, so this file can be applied before or after that one.
  if tg_op = 'DELETE' and tg_level = 'ROW' and to_regprocedure('public.tenant_purge_active(jsonb)') is not null then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A holdout draw is never removed.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    -- Reinstatement cases are never held out: that deadline is permanent.
    if new.selected and exists (
      select 1 from public.reinstatement_case c
       where c.tenant_id = new.tenant_id and c.carrier_id = new.carrier_id and c.policy_number = new.policy_number
         and c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
    ) then
      raise exception 'A policy with an open reinstatement case is never held out.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
    raise exception 'A holdout draw never changes; it can only leave the holdout and be resolved.' using errcode = 'P0001';
  end if;
  if old.left_at is not null and (new.left_at is distinct from old.left_at or new.left_reason is distinct from old.left_reason) then
    raise exception 'A draw that left the holdout never returns to it.' using errcode = 'P0001';
  end if;
  if old.resolved_at is not null and (new.outcome_at_horizon is distinct from old.outcome_at_horizon or new.was_worked is distinct from old.was_worked or new.resolved_at is distinct from old.resolved_at) then
    raise exception 'A resolved draw never changes.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists retention_holdout_guard on public.retention_holdout;
create trigger retention_holdout_guard before insert or update or delete on public.retention_holdout
  for each row execute function public.retention_holdout_guard();

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['prediction_outcome', 'retention_holdout'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to tenant_app using (tenant_id = nullif((select current_setting(''app.tenant_id'', true)), '''')::uuid)', t || '_read', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to tenant_app', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
    execute format('revoke delete, truncate on public.%I from service_role, tenant_app', t);
    execute format('revoke insert, update on public.%I from tenant_app', t);
  end loop;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.retention_settings where holdout_enabled) and not exists (
    select 1 from public.retention_setting_change where setting = 'holdout_enabled'
  ) then
    raise exception '20261016210000: a holdout is on that nobody switched on';
  end if;
  if has_table_privilege('service_role', 'public.retention_holdout', 'DELETE') or has_table_privilege('service_role', 'public.prediction_outcome', 'DELETE')
     or has_table_privilege('tenant_app', 'public.retention_holdout', 'INSERT') then
    raise exception '20261016210000: holdout and prediction records must not be removable';
  end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'retention_settings' and column_name = 'holdout_enabled') <> 'false' then
    raise exception '20261016210000: the holdout must be off by default';
  end if;
end $$;
