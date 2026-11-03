-- Book of business › Setup › Pipeline rules (owner 2026-11-02; docs/la4/SIMPLIFY-PROPOSAL.md §4, §6.4, §7).
--
-- When something happens to a policy, move its lead's card and add a note. No AI: the events are facts
-- the code computes (lib/pipelineRules/events.ts) from policy_current, policy_change, commission_entry
-- and the carrier rules; the checks are code too (lib/pipelineRules/plan.ts), the same for a preview
-- and for a run. A move goes through moveLead (lib/applications/stageSyncService.ts).
--
--   pipeline_rule_settings    one row per agency: the engine on or off, the cap per run (25), the days a
--                             hand move protects a card (7).
--   pipeline_rule             a rule: its name, its mode (draft | forecast | live), on or off, its version.
--                             Owner decision 3: a rule starts in forecast. On/off and the mode are not a
--                             new version.
--   pipeline_rule_version     what a rule says: event, carriers, from-stages, target pipeline and stage,
--                             the note. Changing any of it writes a new version; a version never changes.
--   pipeline_rule_run         each run: when, why, and what it did (moved, would move, skipped, held, and
--                             whether it stopped at the cap).
--   pipeline_rule_evaluation  once per change × rule × version × mode (unique): moved, would move, skipped
--                             or held, with the reason, the stages, the note. A person marks a forecast line
--                             right or wrong; a move can be undone.
--   pipeline_rule_hold        two rules disagree about one card: nothing moves until a person picks (Needs you).
--
-- Also: tenant_lead_stage_events.source accepts 'pipeline_rule'; /api/cron/pipeline-rules joins the app's
-- cron dispatcher (20261015500000) for the morning date check (payments missed with no file arriving).
--
-- Additive and idempotent. The service role writes; tenant_app reads its own tenant's rows. Nothing is
-- backfilled: no rule exists until an agency writes one.
--
-- Rollback (no rule written yet):
--   drop table if exists public.pipeline_rule_hold, public.pipeline_rule_evaluation, public.pipeline_rule_run,
--     public.pipeline_rule_version, public.pipeline_rule, public.pipeline_rule_settings;
--   restore tenant_lead_stage_events_source_check without 'pipeline_rule' (20260926101000's statement) and
--   app_cron_paths() without '/api/cron/pipeline-rules' (20261015500000's); cron.unschedule('app-cron-pipeline-rules').

-- ── settings: the per-agency switch ─────────────────────────────────────────────────────────────────
create table if not exists public.pipeline_rule_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  engine_on boolean not null default true,
  cap_per_run integer not null default 25 check (cap_per_run between 1 and 500),
  hand_move_days integer not null default 7 check (hand_move_days between 0 and 90),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
create index if not exists pipeline_rule_settings_updated_by_idx on public.pipeline_rule_settings (updated_by) where updated_by is not null;

-- ── the rule ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pipeline_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  mode text not null default 'forecast' check (mode in ('draft', 'forecast', 'live')),
  enabled boolean not null default true,
  current_version integer not null default 1 check (current_version >= 1),
  forecast_since timestamptz,
  live_since timestamptz,
  live_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  -- Live from a moment: nothing that happened before it is replayed (unless a person asks, once).
  constraint pipeline_rule_live_since check ((mode = 'live') = (live_since is not null)),
  constraint pipeline_rule_tenant_id_key unique (tenant_id, id)
);
create index if not exists pipeline_rule_tenant_idx on public.pipeline_rule (tenant_id, created_at);
create index if not exists pipeline_rule_active_idx on public.pipeline_rule (tenant_id) where enabled and mode in ('forecast', 'live');
create index if not exists pipeline_rule_live_by_idx on public.pipeline_rule (live_by) where live_by is not null;
create index if not exists pipeline_rule_created_by_idx on public.pipeline_rule (created_by) where created_by is not null;
create index if not exists pipeline_rule_updated_by_idx on public.pipeline_rule (updated_by) where updated_by is not null;

-- ── its versions: what it says, never changed ───────────────────────────────────────────────────────
-- The target stage is not a foreign key: a pipeline or stage an owner deletes must not be blocked by a
-- rule that names it. The run checks the stage is still on the board and skips with that reason.
create table if not exists public.pipeline_rule_version (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  rule_id uuid not null,
  version integer not null check (version >= 1),
  event text not null check (event in (
    'issued', 'waiting_first_payment', 'first_payment_missed', 'later_payment_missed', 'paid_again',
    'lapsed', 'not_taken', 'cancelled', 'declined', 'withdrawn',
    'advance_received', 'commission_credited', 'chargeback_received')),
  -- Empty means every carrier / any stage.
  carrier_ids uuid[] not null default '{}',
  from_stage_ids uuid[] not null default '{}',
  target_pipeline_id uuid not null,
  target_stage_id uuid not null,
  note_on boolean not null default true,
  note_template text check (note_template is null or char_length(note_template) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  constraint pipeline_rule_version_rule foreign key (tenant_id, rule_id) references public.pipeline_rule (tenant_id, id) on delete cascade,
  constraint pipeline_rule_version_once unique (rule_id, version),
  constraint pipeline_rule_version_tenant_id_key unique (tenant_id, id),
  constraint pipeline_rule_version_note check (not note_on or (note_template is not null and char_length(btrim(note_template)) > 0))
);
create index if not exists pipeline_rule_version_tenant_rule_idx on public.pipeline_rule_version (tenant_id, rule_id, version desc);
create index if not exists pipeline_rule_version_created_by_idx on public.pipeline_rule_version (created_by) where created_by is not null;

create or replace function public.pipeline_rule_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'A pipeline rule version is never changed; save a new version instead.' using errcode = 'P0001';
end;
$$;
revoke all on function public.pipeline_rule_version_guard() from public, anon, authenticated, tenant_app;
drop trigger if exists pipeline_rule_version_guard on public.pipeline_rule_version;
create trigger pipeline_rule_version_guard before update on public.pipeline_rule_version
  for each row execute function public.pipeline_rule_version_guard();

-- ── runs ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pipeline_rule_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger text not null check (trigger in ('file', 'daily', 'manual', 'switch_live', 'link')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  moved integer not null default 0 check (moved >= 0),
  would_move integer not null default 0 check (would_move >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  held integer not null default 0 check (held >= 0),
  -- The cap stopped the run: these many moves (live) or would-moves (forecast) wait for a person to look.
  capped_live integer not null default 0 check (capped_live >= 0),
  capped_forecast integer not null default 0 check (capped_forecast >= 0),
  error text,
  constraint pipeline_rule_run_tenant_id_key unique (tenant_id, id)
);
create index if not exists pipeline_rule_run_tenant_idx on public.pipeline_rule_run (tenant_id, started_at desc);

-- ── evaluations: once per change × rule × version × mode ────────────────────────────────────────────
create table if not exists public.pipeline_rule_evaluation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  rule_id uuid not null,
  version_id uuid not null,
  version integer not null check (version >= 1),
  mode text not null check (mode in ('forecast', 'live')),
  run_id uuid references public.pipeline_rule_run(id) on delete set null,
  change_key text not null check (char_length(change_key) between 1 and 400),
  event text not null,
  event_date date not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null check (char_length(policy_number) between 1 and 100),
  lead_id uuid references public.agent_leads(id) on delete set null,
  -- claimed: a live move was claimed and is being made (a crash leaves it here, never moved twice).
  outcome text not null check (outcome in ('claimed', 'moved', 'would_move', 'skipped', 'held', 'failed')),
  reason text check (reason is null or char_length(reason) <= 500),
  from_pipeline_id uuid,
  from_stage_id uuid,
  to_pipeline_id uuid,
  to_stage_id uuid,
  note_body text check (note_body is null or char_length(note_body) <= 4000),
  note_id uuid references public.tenant_lead_notes(id) on delete set null,
  facts jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  checked text check (checked in ('right', 'wrong')),
  checked_note text check (checked_note is null or char_length(checked_note) <= 500),
  checked_by uuid references public.users(id) on delete set null,
  checked_at timestamptz,
  undone_at timestamptz,
  undone_by uuid references public.users(id) on delete set null,
  constraint pipeline_rule_evaluation_rule foreign key (tenant_id, rule_id) references public.pipeline_rule (tenant_id, id) on delete cascade,
  constraint pipeline_rule_evaluation_version foreign key (tenant_id, version_id) references public.pipeline_rule_version (tenant_id, id) on delete cascade,
  constraint pipeline_rule_evaluation_once unique (tenant_id, rule_id, version, mode, change_key),
  constraint pipeline_rule_evaluation_checked check ((checked is null) = (checked_at is null)),
  constraint pipeline_rule_evaluation_undone check (undone_at is null or outcome = 'moved')
);
create index if not exists pipeline_rule_evaluation_policy_idx on public.pipeline_rule_evaluation (tenant_id, carrier_id, policy_number, evaluated_at desc);
create index if not exists pipeline_rule_evaluation_rule_idx on public.pipeline_rule_evaluation (tenant_id, rule_id, evaluated_at desc);
create index if not exists pipeline_rule_evaluation_key_idx on public.pipeline_rule_evaluation (tenant_id, change_key);
create index if not exists pipeline_rule_evaluation_version_idx on public.pipeline_rule_evaluation (tenant_id, version_id);
create index if not exists pipeline_rule_evaluation_carrier_idx on public.pipeline_rule_evaluation (carrier_id);
create index if not exists pipeline_rule_evaluation_lead_idx on public.pipeline_rule_evaluation (lead_id) where lead_id is not null;
create index if not exists pipeline_rule_evaluation_run_idx on public.pipeline_rule_evaluation (run_id) where run_id is not null;
create index if not exists pipeline_rule_evaluation_note_idx on public.pipeline_rule_evaluation (note_id) where note_id is not null;
create index if not exists pipeline_rule_evaluation_checked_by_idx on public.pipeline_rule_evaluation (checked_by) where checked_by is not null;
create index if not exists pipeline_rule_evaluation_undone_by_idx on public.pipeline_rule_evaluation (undone_by) where undone_by is not null;

-- ── holds: two rules disagree about one card ────────────────────────────────────────────────────────
create table if not exists public.pipeline_rule_hold (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null check (mode in ('forecast', 'live')),
  run_id uuid references public.pipeline_rule_run(id) on delete set null,
  lead_id uuid references public.agent_leads(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null check (char_length(policy_number) between 1 and 100),
  -- [{ rule_id, rule_name, version, event, change_key, to_pipeline_id, to_stage_id }]
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  chosen_rule_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  constraint pipeline_rule_hold_resolution check ((status = 'open') = (resolved_at is null))
);
-- One open hold per card and mode: a second disagreement waits behind the first.
create unique index if not exists pipeline_rule_hold_open_idx on public.pipeline_rule_hold (tenant_id, mode, lead_id) where status = 'open';
create index if not exists pipeline_rule_hold_queue_idx on public.pipeline_rule_hold (tenant_id, created_at) where status = 'open';
create index if not exists pipeline_rule_hold_lead_idx on public.pipeline_rule_hold (lead_id) where lead_id is not null;
create index if not exists pipeline_rule_hold_carrier_idx on public.pipeline_rule_hold (carrier_id);
create index if not exists pipeline_rule_hold_run_idx on public.pipeline_rule_hold (run_id) where run_id is not null;
create index if not exists pipeline_rule_hold_resolved_by_idx on public.pipeline_rule_hold (resolved_by) where resolved_by is not null;

-- ── security: RLS, tenant reads, service-role writes, write guards ──────────────────────────────────
-- Supabase grants service_role everything by default: a record that is never removed has its delete and
-- truncate revoked explicitly, and a version (never changed) its update too.
alter table public.pipeline_rule_settings enable row level security;
alter table public.pipeline_rule enable row level security;
alter table public.pipeline_rule_version enable row level security;
alter table public.pipeline_rule_run enable row level security;
alter table public.pipeline_rule_evaluation enable row level security;
alter table public.pipeline_rule_hold enable row level security;

revoke all on public.pipeline_rule_settings, public.pipeline_rule, public.pipeline_rule_version,
  public.pipeline_rule_run, public.pipeline_rule_evaluation, public.pipeline_rule_hold from public, anon, authenticated;

revoke delete, truncate on public.pipeline_rule_settings from service_role;
grant select, insert, update on public.pipeline_rule_settings to service_role;
revoke delete, truncate on public.pipeline_rule from service_role;
grant select, insert, update on public.pipeline_rule to service_role;
revoke update, delete, truncate on public.pipeline_rule_version from service_role;
grant select, insert on public.pipeline_rule_version to service_role;
revoke delete, truncate on public.pipeline_rule_run from service_role;
grant select, insert, update on public.pipeline_rule_run to service_role;
revoke delete, truncate on public.pipeline_rule_evaluation from service_role;
grant select, insert, update on public.pipeline_rule_evaluation to service_role;
revoke delete, truncate on public.pipeline_rule_hold from service_role;
grant select, insert, update on public.pipeline_rule_hold to service_role;

grant select on public.pipeline_rule_settings, public.pipeline_rule, public.pipeline_rule_version,
  public.pipeline_rule_run, public.pipeline_rule_evaluation, public.pipeline_rule_hold to tenant_app;

do $$
declare
  t text;
begin
  foreach t in array array['pipeline_rule_settings', 'pipeline_rule', 'pipeline_rule_version', 'pipeline_rule_run', 'pipeline_rule_evaluation', 'pipeline_rule_hold']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to tenant_app using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t || '_read', t);
  end loop;
end $$;

-- ── the card's history accepts the rule as a source ─────────────────────────────────────────────────
alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound', 'application_sync', 'pipeline_rule'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

-- ── the morning date check: one more route for the cron dispatcher ──────────────────────────────────
create or replace function public.app_cron_paths()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    '/api/cron/period-billing', '/api/cron/invoices-overdue', '/api/cron/metrics-daily', '/api/cron/trial-reminders',
    '/api/cron/notifications', '/api/cron/webhooks', '/api/cron/unclaimed-sla', '/api/cron/callback-reminders',
    '/api/cron/calendar-busy', '/api/cron/licence-lapse', '/api/cron/complaint-deadlines',
    '/api/cron/compliance-monthly', '/api/cron/retention-summary', '/api/cron/deletion-perform',
    '/api/cron/pipeline-rules'
  ]::text[];
$$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20261102100000: pg_cron is not enabled; the pipeline rules date check is not scheduled.';
    return;
  end if;
  begin
    -- 11:00 UTC: early morning across US time zones, after the nightly policy_current refresh.
    perform cron.schedule('app-cron-pipeline-rules', '0 11 * * *', format('select public.call_app_cron(%L)', '/api/cron/pipeline-rules'));
  exception when others then
    raise notice '20261102100000: app-cron-pipeline-rules could not be scheduled (%).', sqlerrm;
  end;
end $$;

-- ── proof ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['pipeline_rule_settings', 'pipeline_rule', 'pipeline_rule_version', 'pipeline_rule_run', 'pipeline_rule_evaluation', 'pipeline_rule_hold']
  loop
    if to_regclass('public.' || t) is null then raise exception '% was not created', t; end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      raise exception '%_read policy is missing', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then raise exception '% must not be readable by anon', t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then raise exception '% must not be deletable by service_role', t; end if;
  end loop;
  if has_table_privilege('service_role', 'public.pipeline_rule_version', 'update') then
    raise exception 'pipeline_rule_version must not be updatable by service_role';
  end if;
  if not ('/api/cron/pipeline-rules' = any (public.app_cron_paths())) then
    raise exception 'app_cron_paths() is missing /api/cron/pipeline-rules';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                   and pg_get_constraintdef(oid) like '%pipeline_rule%') then
    raise exception 'tenant_lead_stage_events_source_check does not accept pipeline_rule';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                   and pg_get_constraintdef(oid) like '%application_sync%' and pg_get_constraintdef(oid) like '%inbound%') then
    raise exception 'tenant_lead_stage_events_source_check lost a source it had';
  end if;
end $$;
