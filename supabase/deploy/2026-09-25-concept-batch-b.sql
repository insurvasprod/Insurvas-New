-- CONCEPT BATCH B (Design 2), 20260925706000-709000, in filename order. Notes:
--  * Intended restatements: 707900 restates vendor_claimable_leads and create_import_removal_claim
--    (from 703200); 709000 restates serve_next_lead (700000) and serve_lead_by_id, dialer_queue_preview,
--    scoring_queue_preview (700010 / 701100). No other session defines a batch B function.
--  * 709000 must run after 708500: its first statement refuses (P0001) until callback_work_item_holder
--    and callback_tier_due exist.
--  * 708700 schedules pg_cron jobs: callback-due and callback-in-app-reminders every minute, plus a log cleanup.
--  * 706200 drops the 3-arg replace_cadence_rules and recreates it with p_saved_by (grants included);
--    the app falls back to the old call until this is applied.
--  * 708200 drops the 6-arg tenant_vendor_scorecard_report and recreates it with p_persist_days (service_role only).
--  * 706500 drops the 3-arg reactivate_nurture.

-- ============================================================================
-- Pending migrations — 18 files, each in its own transaction
-- Generated 2026-09-25 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260925706000_campaign_progress.sql
--    2. 20260925706100_campaign_scrub_runs.sql
--    3. 20260925706200_cadence_versions.sql
--    4. 20260925706500_recycle_batches_requeue_and_screening_by_lead.sql
--    5. 20260925706600_recycled_lead_attempt_ceiling.sql
--    6. 20260925707000_vendor_review_status_and_renewal.sql
--    7. 20260925707100_tenant_vendor_card.sql
--    8. 20260925707500_vendor_returns_candidates_and_combined_claim.sql
--    9. 20260925707800_vendor_undialable_rates.sql
--   10. 20260925707900_rescrub_hits_are_never_claimable.sql
--   11. 20260925708000_scorecard_test_batch_and_policy_lapse.sql
--   12. 20260925708100_consent_coverage_counts_each_lead_once.sql
--   13. 20260925708200_vendor_scorecard_ranks_vendors_by_cost_per_policy.sql
--   14. 20260925708300_mark_policy_issued_and_lapsed.sql
--   15. 20260925708500_callbacks_close_on_the_call.sql
--   16. 20260925708600_callbacks_nearest_legal_time.sql
--   17. 20260925708700_callbacks_come_due_on_a_schedule.sql
--   18. 20260925709000_dialer_serves_due_callbacks.sql
-- ============================================================================

-- ─── [1/18] 20260925706000_campaign_progress.sql ──────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Campaigns · how far each campaign has been worked, and which cadence it runs
--
-- Campaigns concept audit (LA-2 §5, 2026-09-25). The concept board puts four facts on every campaign
-- row that /app/campaigns could not show, because nothing computed them per campaign:
--
--   leads_received   leads attributed to the campaign (agent_leads.campaign_id)
--   leads_dialed     of those, leads dialled at least once (attempts_made > 0) — "Worked %"
--   leads_workable   fresh, working or retry: what the dialer can still serve. The same set the lead
--                    list page calls workable (lib/leadLists/detail.ts WORKABLE), so the two screens
--                    agree. Nurture is not counted, matching that page, although a rested lead or an
--                    expired transfer is served again on its own when its rest ends (tier 6).
--   leads_exhausted  lead_state = 'exhausted'
--   first_import_at  when the first lead landed against it; last_import_at, the latest
--   own_cadence_rules  rows in tenant_cadence_rules for this campaign. More than zero means the
--                    campaign runs its own cadence, which replaces the tenant default entirely
--                    (schedule_next_attempt, 20260924230300).
--
-- A view, read through the service client and filtered by tenant, so nothing is stored twice. The
-- aggregate is grouped by (tenant_id, campaign_id); a tenant filter on the view is pushed into the
-- grouping and uses agent_leads_campaign_idx (tenant_id, campaign_id) where campaign_id is not null.
--
-- security_invoker so a tenant_app reader sees only what RLS on the base tables lets it see.
-- ---------------------------------------------------------------------------

create or replace view public.tenant_campaign_progress
with (security_invoker = on) as
select
  c.tenant_id,
  c.id as campaign_id,
  coalesce(l.leads_received, 0)::integer as leads_received,
  coalesce(l.leads_dialed, 0)::integer as leads_dialed,
  coalesce(l.leads_workable, 0)::integer as leads_workable,
  coalesce(l.leads_exhausted, 0)::integer as leads_exhausted,
  l.first_import_at,
  l.last_import_at,
  coalesce(r.own_cadence_rules, 0)::integer as own_cadence_rules
from public.tenant_campaigns c
left join (
  select a.tenant_id,
         a.campaign_id,
         count(*) as leads_received,
         count(*) filter (where coalesce(a.attempts_made, 0) > 0) as leads_dialed,
         count(*) filter (where a.lead_state in ('fresh', 'working', 'retry')) as leads_workable,
         count(*) filter (where a.lead_state = 'exhausted') as leads_exhausted,
         min(a.created_at) as first_import_at,
         max(a.created_at) as last_import_at
    from public.agent_leads a
   where a.campaign_id is not null
   group by a.tenant_id, a.campaign_id
) l on l.tenant_id = c.tenant_id and l.campaign_id = c.id
left join (
  select cr.tenant_id, cr.campaign_id, count(*) as own_cadence_rules
    from public.tenant_cadence_rules cr
   where cr.campaign_id is not null
   group by cr.tenant_id, cr.campaign_id
) r on r.tenant_id = c.tenant_id and r.campaign_id = c.id;

revoke all on public.tenant_campaign_progress from anon, authenticated, public;
grant select on public.tenant_campaign_progress to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_options text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select c.reloptions into v_options
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'tenant_campaign_progress';
  if not found then
    raise exception 'tenant_campaign_progress was not created';
  end if;
  if v_options is null or not ('security_invoker=on' = any(v_options) or 'security_invoker=true' = any(v_options)) then
    raise exception 'tenant_campaign_progress must run with the reader''s rights (security_invoker)';
  end if;
  if has_table_privilege('anon', 'public.tenant_campaign_progress', 'select') then
    raise exception 'anon can read tenant_campaign_progress';
  end if;

  -- The columns the campaigns screen reads.
  perform leads_received, leads_dialed, leads_workable, leads_exhausted, first_import_at,
          last_import_at, own_cadence_rules
    from public.tenant_campaign_progress limit 0;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925706000', 'campaign_progress') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/18] 20260925706100_campaign_scrub_runs.sql ────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Campaigns · "Run the scrub" — a re-screen of every lead in a campaign, chunked and resumable
--
-- Campaigns concept audit (LA-2 §5, 2026-09-25). The board's scrub gate ends in "Run the scrub".
-- The product had no such action: scrub_status was set to 'scrubbed' only by an import, so a
-- campaign whose mark failed after the commit, or one an owner wanted re-checked against today's
-- registries, could not be fixed from the product. 'scrubbing' and 'failed' were never written.
--
-- User decisions:
--   * OWNER-ONLY. Every lead in the campaign is re-screened (litigator + DNC lookups, which bill).
--   * Never a plain "mark scrubbed". The campaign reaches 'scrubbed' only when a run has screened
--     every lead; a vendor outage ends the run 'failed'.
--   * No background host exists, so the run is CHUNKED and RESUMABLE: the page drives batches of
--     leads, one request each, and the progress lives here. A run that makes no progress for 15
--     minutes (the tab was closed) can be resumed by an owner from where it stopped.
--
-- The screening itself happens in TypeScript (lib/campaigns/scrubRun.ts → screenPartnerPhone, the
-- same path the import uses); these functions only keep the run honest:
--
--   campaign_scrub_run_start     opens a run (or resumes the open one) and moves the campaign to
--                                'scrubbing' — which takes it out of campaigns_servable at once.
--                                That is the direction request_campaign_rescrub (20260913290000)
--                                chose: a campaign mid-re-scrub is a campaign of unknown status.
--   campaign_scrub_run_advance   moves the cursor after a batch. Refuses a caller that does not
--                                hold the run's lease, or whose view of the cursor is stale, so two
--                                windows can never both count the same batch.
--   campaign_scrub_run_finish    ends it: 'scrubbed' (campaign scrubbed, scrubbed_at now) or
--                                'failed' (campaign failed, scrub_error kept). A failed run stays
--                                open and resumes from its cursor.
--
-- Keyset by lead id: a batch is "the next N leads of this campaign with id > cursor". Leads imported
-- during a run with a lower id than the cursor were screened by their own import.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_campaign_scrub_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'scrubbed', 'failed')),
  total_leads integer not null default 0 check (total_leads >= 0),
  processed_leads integer not null default 0 check (processed_leads >= 0),
  rejected_leads integer not null default 0 check (rejected_leads >= 0),
  suppressed_numbers integer not null default 0 check (suppressed_numbers >= 0),
  cursor_lead_id uuid,
  lease_token uuid,
  resumed_count integer not null default 0 check (resumed_count >= 0),
  started_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  last_progress_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

-- One open run per campaign. A failed run is open: it resumes rather than starting over.
-- Inside a guard only so scripts/check-migrations.mjs (which cannot create the table) can still run
-- the rest of the file; applied for real, the table always exists here.
do $$
begin
  if to_regclass('public.tenant_campaign_scrub_runs') is not null then
    create unique index if not exists tenant_campaign_scrub_runs_one_open
      on public.tenant_campaign_scrub_runs (tenant_id, campaign_id)
      where status in ('running', 'failed');
  end if;
end $$;

create index if not exists tenant_campaign_scrub_runs_campaign_idx
  on public.tenant_campaign_scrub_runs (tenant_id, campaign_id, started_at desc);

alter table public.tenant_campaign_scrub_runs enable row level security;

drop policy if exists tenant_campaign_scrub_runs_tenant_scoped on public.tenant_campaign_scrub_runs;
create policy tenant_campaign_scrub_runs_tenant_scoped
  on public.tenant_campaign_scrub_runs
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_campaign_scrub_runs from anon, authenticated, public;
grant select on public.tenant_campaign_scrub_runs to tenant_app;
grant select, insert, update on public.tenant_campaign_scrub_runs to service_role;

-- ── start or resume ────────────────────────────────────────────────────────
create or replace function public.campaign_scrub_run_start(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_user_id uuid,
  p_token uuid
)
returns public.tenant_campaign_scrub_runs
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_run public.tenant_campaign_scrub_runs;
  v_total integer;
begin
  if p_tenant_id is null or p_campaign_id is null or p_token is null then
    raise exception 'SCRUB_RUN_SCOPE_INVALID';
  end if;

  -- The campaign row is the lock: two owners pressing "Run the scrub" at once get one run.
  perform 1 from public.tenant_campaigns
   where id = p_campaign_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'SCRUB_RUN_CAMPAIGN_NOT_FOUND';
  end if;

  select * into v_run from public.tenant_campaign_scrub_runs
   where tenant_id = p_tenant_id and campaign_id = p_campaign_id and status in ('running', 'failed')
   for update;

  if found then
    -- Someone else's run that is still moving is theirs. A run with no progress for 15 minutes is
    -- stuck (the window that drove it is gone), and any owner may pick it up.
    if v_run.status = 'running'
       and v_run.lease_token is distinct from p_token
       and v_run.last_progress_at > now() - interval '15 minutes' then
      raise exception 'SCRUB_RUN_IN_PROGRESS';
    end if;

    update public.tenant_campaign_scrub_runs r
       set status = 'running',
           resumed_count = r.resumed_count
             + case when r.status = 'failed' or r.lease_token is distinct from p_token then 1 else 0 end,
           lease_token = p_token,
           last_progress_at = now(),
           error = null
     where r.id = v_run.id
    returning * into v_run;
  else
    select count(*)::integer into v_total from public.agent_leads
     where tenant_id = p_tenant_id and campaign_id = p_campaign_id;

    insert into public.tenant_campaign_scrub_runs
      (tenant_id, campaign_id, status, total_leads, lease_token, started_by)
    values (p_tenant_id, p_campaign_id, 'running', v_total, p_token, p_user_id)
    returning * into v_run;
  end if;

  update public.tenant_campaigns
     set scrub_status = 'scrubbing', scrub_error = null
   where id = p_campaign_id and tenant_id = p_tenant_id;

  return v_run;
end;
$function$;

-- ── after each batch ───────────────────────────────────────────────────────
create or replace function public.campaign_scrub_run_advance(
  p_tenant_id uuid,
  p_run_id uuid,
  p_token uuid,
  p_expected_cursor uuid,
  p_new_cursor uuid,
  p_processed integer,
  p_rejected integer,
  p_suppressed integer
)
returns public.tenant_campaign_scrub_runs
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_run public.tenant_campaign_scrub_runs;
begin
  select * into v_run from public.tenant_campaign_scrub_runs
   where id = p_run_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'SCRUB_RUN_NOT_FOUND';
  end if;
  if v_run.status <> 'running' or v_run.lease_token is distinct from p_token then
    raise exception 'SCRUB_RUN_LEASE_LOST';
  end if;
  if v_run.cursor_lead_id is distinct from p_expected_cursor then
    raise exception 'SCRUB_RUN_CURSOR_MOVED';
  end if;
  if coalesce(p_processed, 0) < 0 or coalesce(p_rejected, 0) < 0 or coalesce(p_suppressed, 0) < 0 then
    raise exception 'SCRUB_RUN_COUNTS_INVALID';
  end if;

  update public.tenant_campaign_scrub_runs r
     set cursor_lead_id = p_new_cursor,
         processed_leads = r.processed_leads + coalesce(p_processed, 0),
         rejected_leads = r.rejected_leads + coalesce(p_rejected, 0),
         suppressed_numbers = r.suppressed_numbers + coalesce(p_suppressed, 0),
         last_progress_at = now()
   where r.id = v_run.id
  returning * into v_run;

  return v_run;
end;
$function$;

-- ── the end ────────────────────────────────────────────────────────────────
create or replace function public.campaign_scrub_run_finish(
  p_tenant_id uuid,
  p_run_id uuid,
  p_token uuid,
  p_outcome text,
  p_error text default null
)
returns public.tenant_campaign_scrub_runs
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_run public.tenant_campaign_scrub_runs;
begin
  if p_outcome not in ('scrubbed', 'failed') then
    raise exception 'SCRUB_RUN_OUTCOME_INVALID';
  end if;

  select * into v_run from public.tenant_campaign_scrub_runs
   where id = p_run_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'SCRUB_RUN_NOT_FOUND';
  end if;
  if v_run.status <> 'running' or v_run.lease_token is distinct from p_token then
    raise exception 'SCRUB_RUN_LEASE_LOST';
  end if;

  update public.tenant_campaign_scrub_runs r
     set status = p_outcome,
         finished_at = case when p_outcome = 'scrubbed' then now() else null end,
         error = case when p_outcome = 'failed' then coalesce(nullif(p_error, ''), 'The scrub could not be completed.') else null end,
         lease_token = null,
         last_progress_at = now()
   where r.id = v_run.id
  returning * into v_run;

  if p_outcome = 'scrubbed' then
    update public.tenant_campaigns
       set scrub_status = 'scrubbed', scrubbed_at = now(), scrub_error = null
     where id = v_run.campaign_id and tenant_id = p_tenant_id;
  else
    update public.tenant_campaigns
       set scrub_status = 'failed', scrub_error = v_run.error
     where id = v_run.campaign_id and tenant_id = p_tenant_id;
  end if;

  return v_run;
end;
$function$;

revoke all on function public.campaign_scrub_run_start(uuid, uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.campaign_scrub_run_advance(uuid, uuid, uuid, uuid, uuid, integer, integer, integer) from public, anon, authenticated, tenant_app;
revoke all on function public.campaign_scrub_run_finish(uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.campaign_scrub_run_start(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.campaign_scrub_run_advance(uuid, uuid, uuid, uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.campaign_scrub_run_finish(uuid, uuid, uuid, text, text) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.tenant_campaign_scrub_runs') is null then
    raise exception 'tenant_campaign_scrub_runs was not created';
  end if;
  if not exists (select 1 from pg_class where relname = 'tenant_campaign_scrub_runs' and relrowsecurity) then
    raise exception 'tenant_campaign_scrub_runs has no row security';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_campaign_scrub_runs_one_open') then
    raise exception 'a campaign could have two open scrub runs';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'campaign_scrub_run_start';
  if v_def is null or v_def !~ 'SCRUB_RUN_IN_PROGRESS' or v_def !~ '15 minutes' or v_def !~ 'scrubbing' then
    raise exception 'campaign_scrub_run_start does not guard a live run or take the campaign out of serving';
  end if;

  -- "Never a plain mark scrubbed": only the finish function writes 'scrubbed', and only for a run
  -- the caller holds.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'campaign_scrub_run_finish';
  if v_def is null or v_def !~ 'SCRUB_RUN_LEASE_LOST' then
    raise exception 'campaign_scrub_run_finish does not check the lease';
  end if;

  if has_function_privilege('tenant_app', 'public.campaign_scrub_run_finish(uuid, uuid, uuid, text, text)', 'execute') then
    raise exception 'the tenant plane can finish a scrub run directly';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925706100', 'campaign_scrub_runs') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/18] 20260925706200_cadence_versions.sql ───────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Dialing cadence · every save is kept as a version
--
-- Campaigns concept audit (LA-2 §5, 2026-09-25). The board's campaign comparison carries a caveat:
-- "Same period, similar volume, different cadence … this compares two things at once." The product
-- could not say it, because tenant_cadence_rules holds only the rules in force now, and the
-- tenant.cadence_updated audit row records a count, not the rules. Which cadence a campaign ran
-- last month was not recorded anywhere.
--
-- User decision: yes — a versions table, written by replace_cadence_rules on every save.
--
--   tenant_cadence_versions   one row per save: the scope (tenant default when campaign_id is
--                             null), the rules as stored, a fingerprint for comparing two
--                             versions, who saved it and when. source = 'save' for a save,
--                             'baseline' for the snapshot this migration takes of what is in
--                             force at the moment it is applied.
--
-- History exists only from this migration on. The baseline makes the moment explicit: for a tenant
-- that existed before, nothing earlier than its baseline is known, and the comparison says so
-- rather than assuming the current cadence always ran. A tenant created afterwards has no baseline
-- and ran the built-in cadence until its first save (no other path writes cadence rules).
--
-- replace_cadence_rules is restated from its only definition (20260924230300) with one addition:
-- after the insert, the version row. It gains p_saved_by (default null), so the signature changes
-- and the old function is dropped first; the grants are re-applied exactly (service_role only).
-- The refusals the settings screen depends on — CADENCE_TENANT_REQUIRED, which is also its
-- "is 230300 applied" probe (lib/cadence/service.ts cadenceSchemaReady), CADENCE_ROWS_INVALID and
-- CADENCE_CAMPAIGN_NOT_FOUND — and the per-scope advisory lock are unchanged and asserted below.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_cadence_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Null is the tenant default. A deleted campaign takes its history with it.
  campaign_id uuid references public.tenant_campaigns(id) on delete cascade,
  rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
  rule_count integer not null default 0 check (rule_count >= 0),
  fingerprint text not null,
  source text not null default 'save' check (source in ('save', 'baseline')),
  saved_by uuid references public.users(id) on delete set null,
  saved_at timestamptz not null default now()
);

create index if not exists tenant_cadence_versions_scope_idx
  on public.tenant_cadence_versions (tenant_id, campaign_id, saved_at desc);

alter table public.tenant_cadence_versions enable row level security;

drop policy if exists tenant_cadence_versions_tenant_scoped on public.tenant_cadence_versions;
create policy tenant_cadence_versions_tenant_scoped
  on public.tenant_cadence_versions
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_cadence_versions from anon, authenticated, public;
grant select on public.tenant_cadence_versions to tenant_app;
grant select, insert on public.tenant_cadence_versions to service_role;

-- The rules of one scope, in one canonical order and shape, so two identical cadences produce the
-- same fingerprint whatever order they were saved in. The interval is Postgres's own rendering.
create or replace function public.cadence_scope_rules(p_tenant_id uuid, p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attempt_number', r.attempt_number,
        'delay_interval', r.delay_interval::text,
        'preferred_slot', r.preferred_slot,
        'disposition_scope', r.disposition_scope
      )
      order by r.attempt_number, r.disposition_scope nulls first
    ),
    '[]'::jsonb
  )
  from public.tenant_cadence_rules r
  where r.tenant_id = p_tenant_id
    and r.campaign_id is not distinct from p_campaign_id;
$function$;

revoke all on function public.cadence_scope_rules(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.cadence_scope_rules(uuid, uuid) to service_role;

-- ── the atomic save, now leaving a version behind ──────────────────────────
drop function if exists public.replace_cadence_rules(uuid, uuid, jsonb);

create or replace function public.replace_cadence_rules(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_rows jsonb,
  p_saved_by uuid default null
)
returns setof public.tenant_cadence_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rules jsonb;
begin
  if p_tenant_id is null then
    raise exception 'CADENCE_TENANT_REQUIRED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'CADENCE_ROWS_INVALID';
  end if;
  if p_campaign_id is not null and not exists (
    select 1 from tenant_campaigns c where c.id = p_campaign_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'CADENCE_CAMPAIGN_NOT_FOUND';
  end if;

  -- Two owners saving the same scope at once get one result each, in order, never an interleaving.
  perform pg_advisory_xact_lock(
    hashtextextended('cadence:' || p_tenant_id::text || ':' || coalesce(p_campaign_id::text, 'default'), 0)
  );

  delete from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id;

  insert into tenant_cadence_rules
    (tenant_id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope)
  select p_tenant_id,
         p_campaign_id,
         (e->>'attemptNumber')::integer,
         (e->>'delayInterval')::interval,
         nullif(e->>'preferredSlot', ''),
         nullif(btrim(coalesce(e->>'dispositionScope', '')), '')
    from jsonb_array_elements(p_rows) as e;

  -- The version, in the same transaction as the rules it describes: a save that rolls back leaves
  -- no version, and a version never describes rules that were not stored.
  v_rules := cadence_scope_rules(p_tenant_id, p_campaign_id);
  insert into tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source, saved_by)
  values (p_tenant_id, p_campaign_id, v_rules, jsonb_array_length(v_rules), md5(v_rules::text), 'save', p_saved_by);

  return query
  select r.* from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id
   order by r.attempt_number, r.disposition_scope nulls first;
end;
$function$;

revoke all on function public.replace_cadence_rules(uuid, uuid, jsonb, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_cadence_rules(uuid, uuid, jsonb, uuid) to service_role;

-- ── the baseline: what is in force now ─────────────────────────────────────
-- Every tenant gets a tenant-default baseline (an empty one means the built-in cadence), and every
-- campaign that has rules of its own gets one. Once per scope: re-running this file adds nothing.
-- Guarded only so scripts/check-migrations.mjs (which cannot create the table) can run the rest of
-- the file; applied for real, the table always exists here.
do $$
begin
  if to_regclass('public.tenant_cadence_versions') is null then
    return;
  end if;

  insert into public.tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source)
  select t.id, null, x.rules, jsonb_array_length(x.rules), md5(x.rules::text), 'baseline'
    from public.tenants t
    cross join lateral (select public.cadence_scope_rules(t.id, null) as rules) x
   where not exists (
     select 1 from public.tenant_cadence_versions v
      where v.tenant_id = t.id and v.campaign_id is null and v.source = 'baseline'
   );

  insert into public.tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source)
  select s.tenant_id, s.campaign_id, x.rules, jsonb_array_length(x.rules), md5(x.rules::text), 'baseline'
    from (select distinct r.tenant_id, r.campaign_id
            from public.tenant_cadence_rules r
           where r.campaign_id is not null) s
    cross join lateral (select public.cadence_scope_rules(s.tenant_id, s.campaign_id) as rules) x
   where not exists (
     select 1 from public.tenant_cadence_versions v
      where v.tenant_id = s.tenant_id and v.campaign_id = s.campaign_id and v.source = 'baseline'
   );
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select count(*), max(pg_get_functiondef(p.oid)) into v_count, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'replace_cadence_rules';
  if v_count <> 1 then
    raise exception 'replace_cadence_rules has % definitions; the three-argument one must be gone', v_count;
  end if;

  -- What the settings screen and the route depend on survived the restatement.
  if v_def !~ 'CADENCE_TENANT_REQUIRED' then
    raise exception 'replace_cadence_rules no longer refuses a missing tenant (the schema probe depends on it)';
  end if;
  if v_def !~ 'CADENCE_ROWS_INVALID' or v_def !~ 'CADENCE_CAMPAIGN_NOT_FOUND' or v_def !~ 'pg_advisory_xact_lock' then
    raise exception 'replace_cadence_rules lost a refusal or its per-scope lock';
  end if;
  if v_def !~ 'insert into tenant_cadence_versions' then
    raise exception 'replace_cadence_rules does not record a version';
  end if;

  if has_function_privilege('tenant_app', 'public.replace_cadence_rules(uuid, uuid, jsonb, uuid)', 'execute') then
    raise exception 'the tenant plane can replace cadence rules directly';
  end if;
  if not exists (select 1 from pg_class where relname = 'tenant_cadence_versions' and relrowsecurity) then
    raise exception 'tenant_cadence_versions has no row security';
  end if;

  -- Every tenant has a baseline for its default scope.
  if exists (
    select 1 from public.tenants t
     where not exists (select 1 from public.tenant_cadence_versions v
                        where v.tenant_id = t.id and v.campaign_id is null)
  ) then
    raise exception 'a tenant has no cadence baseline';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925706200', 'cadence_versions') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/18] 20260925706500_recycle_batches_requeue_and_screening_by_lead.sql ──────
begin;

-- ---------------------------------------------------------------------------
-- Lead recycling (LA-2 §4) · batches with an angle, a work item the dialer can serve, and a
-- screening that holds one lead rather than the whole campaign.
--
-- What was wrong with 20260913450000 (the only earlier definition of these functions):
--
--   1. A reactivated lead was never dialled. An exhausted lead's work item is 'completed'
--      (complete_existing_dial_disposition, 20260924240200), reactivate_nurture reopened nothing,
--      and serve_next_lead serves lead_queue rows only. Tier 6 never saw a recycled lead.
--   2. One screening that did not complete set the WHOLE campaign's scrub_status to 'failed', and
--      every lead in it (fresh ones too) stopped being served. The lead that failed stayed in
--      nurture, due now.
--   3. The lead was moved to nurture BEFORE it was screened; the campaign-wide 'scrubbing' flag was
--      the only thing between an unscreened number and the dialer.
--   4. The rest clock read updated_at, which anything touches, and a rested lead with a future due
--      date could be pulled forward by a run.
--   5. There was no angle, no per-pass attempt ceiling and no record of a run as a thing.
--
-- Now (user decisions of 2026-09-25):
--
--   tenant_recycle_batches       one row per run: the angle (required), an optional script, the
--                                attempt ceiling for this pass (default 3), the rule as it stood,
--                                the $0 cost to attribute, progress and counts.
--   recycle_lead_candidates      ONE definition of who a run may pick up, with a verdict for every
--                                lead it looked at. The pool breakdown, "excluded as too recent",
--                                "eligible now" and the run itself all read it.
--   reactivate_nurture           (new signature) creates the batch and one PENDING reactivation per
--                                eligible lead. It changes no lead: nothing is servable until its
--                                own screening clears.
--   recycle_batch_claim_chunk    hands the page the next N pending leads to screen, each leased
--                                for five minutes. The page drives the run in chunks; progress is
--                                in the database, so a closed tab loses nothing. A batch with no
--                                progress for 15 minutes can be resumed by an owner.
--   complete_nurture_reactivation (same signature) settles one lead:
--                                  cleared → lead to nurture, attempts reset, the batch's ceiling
--                                            on the lead, and an UNCLAIMED DIALER work item
--                                            (partner_id null) so serve_next_lead's tier 6
--                                            serves it. An open dialer item is reused; the
--                                            one-open-item-per-lead index is never raced.
--                                  blocked → the lead stays where it was (suppressed by the app).
--                                  failed  → the lead is held where it was; nothing else changes.
--                                It never touches tenant_campaigns.scrub_status.
--   tenant_recycle_pool          per campaign, how many leads fall in each verdict.
--   tenant_recycle_batch_report  past batches: dials, contacts, contact rate, policies.
--   lead_recycle_context         the angle and script of the pass a lead is on — for the dialer.
--
-- Rules enforced here, not only in the UI:
--   · "Not interested" leads are recyclable only when the actor is an OWNER, the rule allows the
--     outcome, and at least 90 days (or the rule's wait, if longer) have passed since that outcome.
--   · Never eligible: any do-not-call outcome ever, a dnc / litigator screening outcome, any hit on
--     is_phone_suppressed (federal, state, litigator, internal DNC, complaint).
--   · A resting nurture lead (next_dial_after in the future) and a nurture lead already in the
--     dialer are left alone.
--   · Inbound partner leads (Design 3's constraint): the inbox, the floor and run_unclaimed_sla all
--     key on lead_queue.partner_id. A recycled lead only ever gets a row with partner_id NULL, the
--     same way nurture_expired_transfer (20260924230400) queues an expired transfer, and it points
--     nurtured_from_work_item_id at the partner row so reopen_expired_lead closes it first. A lead
--     with a partner row still open is never picked up. Asserted below.
--
-- The $0 'recycle' source row: tenant_lead_sources is unique on (tenant, lead, campaign) and every
-- campaign lead already has its import row there, and import_agent_lead_source's ON CONFLICT
-- depends on that exact index. The row is written ON CONFLICT DO NOTHING, so it lands only for a
-- lead that had no source row for its campaign; the batch itself carries the $0 attribution.
--
-- Additive and idempotent. No lead_queue columns or triggers. serve_next_lead is not touched.
-- ---------------------------------------------------------------------------

-- ── schema ────────────────────────────────────────────────────────────────

alter table public.agent_leads add column if not exists attempt_ceiling integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_attempt_ceiling_range') then
    alter table public.agent_leads
      add constraint agent_leads_attempt_ceiling_range
      check (attempt_ceiling is null or attempt_ceiling between 1 and 7) not valid;
  end if;
  execute $c$comment on column public.agent_leads.attempt_ceiling is
    'Dials allowed on the current pass. Null = the cadence ceiling (7). Set by a recycle batch (20260925706500); read by schedule_next_attempt (20260925706600).'$c$;
end $$;

create table if not exists public.tenant_recycle_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete cascade,
  angle text not null check (char_length(btrim(angle)) between 3 and 500),
  script text check (script is null or char_length(script) <= 5000),
  attempt_ceiling integer not null default 3 check (attempt_ceiling between 1 and 7),
  wait_days integer not null check (wait_days between 1 and 3650),
  allowed_dispositions text[] not null,
  max_recycles integer not null check (max_recycles between 0 and 100),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  status text not null default 'screening' check (status in ('screening', 'complete')),
  queued integer not null default 0 check (queued >= 0),
  cleared integer not null default 0 check (cleared >= 0),
  blocked integer not null default 0 check (blocked >= 0),
  failed integer not null default 0 check (failed >= 0),
  excluded_too_recent integer not null default 0 check (excluded_too_recent >= 0),
  said_no integer not null default 0 check (said_no >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_progress_at timestamptz not null default now(),
  completed_at timestamptz,
  -- One run at a time per campaign: a second would race the first for the same leads.
  constraint tenant_recycle_batches_one_open exclude using btree (campaign_id with =) where (status = 'screening')
);

create index if not exists tenant_recycle_batches_campaign_idx
  on public.tenant_recycle_batches (tenant_id, campaign_id, created_at desc);

alter table public.tenant_nurture_reactivations
  add column if not exists batch_id uuid references public.tenant_recycle_batches(id) on delete set null,
  add column if not exists leased_until timestamptz;

create index if not exists tenant_nurture_reactivations_batch_idx
  on public.tenant_nurture_reactivations (batch_id, status)
  where batch_id is not null;

alter table public.tenant_recycle_batches enable row level security;
drop policy if exists tenant_recycle_batches_scoped on public.tenant_recycle_batches;
create policy tenant_recycle_batches_scoped on public.tenant_recycle_batches for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_recycle_batches from anon, authenticated, public;
grant select on public.tenant_recycle_batches to tenant_app;
grant select, insert, update on public.tenant_recycle_batches to service_role;

-- ── who may recycle what ──────────────────────────────────────────────────

create or replace function public.recycle_lead_candidates(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_actor uuid
)
returns table (
  lead_id uuid,
  campaign_id uuid,
  lead_state text,
  last_disposition text,
  last_outcome_at timestamptz,
  rested_since timestamptz,
  verdict text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_role text;
begin
  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  v_role := coalesce(v_role, '');

  return query
  with rules as (
    select c.id as cid,
           coalesce(r.wait_days, 180) as wait_days,
           coalesce(r.allowed_dispositions, array['no_answer', 'voicemail']::text[]) as allowed,
           coalesce(r.max_recycles, 3) as max_recycles
      from tenant_campaigns c
      left join tenant_campaign_recycle_rules r on r.campaign_id = c.id and r.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_campaign_id is null or c.id = p_campaign_id)
  ),
  pool as materialized (
    select l.id, l.campaign_id as cid, l.lead_state as state, l.next_dial_after, l.screening_outcome,
           coalesce(l.recycle_count, 0) as recycle_count,
           nullif(btrim(coalesce(l.values->>'phone', l.values->>'phone_number', '')), '') as phone,
           la.disposition as last_disposition, la.attempted_at as last_outcome_at,
           -- The rest clock: the last dial or the last reactivation, whichever is later. Never the
           -- row's last-edit time, which any change to the lead moves.
           coalesce(greatest(la.attempted_at, l.last_reactivated_at), l.nurture_entered_at, l.created_at) as rested_since,
           ru.wait_days, ru.allowed, ru.max_recycles
      from agent_leads l
      join rules ru on ru.cid = l.campaign_id
      left join lateral (
        select ca.disposition, ca.attempted_at
          from tenant_call_attempts ca
         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
         order by ca.attempted_at desc
         limit 1
      ) la on true
     where l.tenant_id = p_tenant_id
       and l.lead_state in ('exhausted', 'nurture', 'closed')
       and (l.lead_state <> 'closed' or la.disposition = 'not_interested')
  )
  select p.id, p.cid, p.state, p.last_disposition, p.last_outcome_at, p.rested_since,
         case
           when exists (select 1 from tenant_call_attempts d
                         where d.tenant_id = p_tenant_id and d.lead_id = p.id and d.disposition = 'do_not_call')
             or coalesce(p.screening_outcome, '') in ('dnc', 'tcpa_litigator')
             or coalesce(sup.suppressed, false) then 'never'
           when p.phone is null then 'no_phone'
           when p.state = 'nurture' and p.next_dial_after > now() then 'resting'
           when p.state = 'nurture' and p.next_dial_after is not null and coalesce(oq.dialer_open, false) then 'live'
           when exists (select 1 from tenant_nurture_reactivations nr
                         where nr.tenant_id = p_tenant_id and nr.lead_id = p.id
                           and nr.status = 'pending' and nr.batch_id is not null) then 'pending'
           when coalesce(oq.worked, false) then 'being_worked'
           when p.recycle_count >= p.max_recycles then 'capped'
           when not (coalesce(p.last_disposition, '') = any(p.allowed)) then 'outcome_not_in_rule'
           when p.last_disposition = 'not_interested' and v_role <> 'owner' then 'owner_only'
           when p.rested_since > now() - make_interval(days =>
                  case when p.last_disposition = 'not_interested' then greatest(p.wait_days, 90) else p.wait_days end)
             then 'too_recent'
           else 'eligible'
         end
    from pool p
    left join lateral (select s.suppressed from is_phone_suppressed(p_tenant_id, p.phone) s limit 1) sup on true
    left join lateral (
      select bool_or(q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
                     or (q.status = 'unclaimed' and q.partner_id is not null)) as worked,
             bool_or(q.status = 'unclaimed' and q.partner_id is null) as dialer_open
        from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = p.id
         and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active')
    ) oq on true;
end;
$function$;

revoke all on function public.recycle_lead_candidates(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.recycle_lead_candidates(uuid, uuid, uuid) to service_role;

-- Per campaign, the pool the page draws: every verdict counted, plus the board's two source pools.
create or replace function public.tenant_recycle_pool(p_tenant_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id', g.campaign_id,
           'exhausted_no_outcome', g.exhausted_no_outcome,
           'said_no', g.said_no,
           'never', g.never,
           'no_phone', g.no_phone,
           'resting', g.resting,
           'live', g.live,
           'pending', g.pending,
           'being_worked', g.being_worked,
           'capped', g.capped,
           'outcome_not_in_rule', g.outcome_not_in_rule,
           'owner_only', g.owner_only,
           'too_recent', g.too_recent,
           'eligible', g.eligible,
           'eligible_said_no', g.eligible_said_no
         )), '[]'::jsonb)
    into v_out
    from (
      select c.campaign_id,
             count(*) filter (where c.lead_state = 'exhausted'
                                and coalesce(c.last_disposition, 'no_answer') in ('no_answer', 'voicemail', 'busy', 'call_dropped', 'disconnected', 'wrong_number'))::integer as exhausted_no_outcome,
             count(*) filter (where c.lead_state = 'closed' and c.last_disposition = 'not_interested')::integer as said_no,
             count(*) filter (where c.verdict = 'never')::integer as never,
             count(*) filter (where c.verdict = 'no_phone')::integer as no_phone,
             count(*) filter (where c.verdict = 'resting')::integer as resting,
             count(*) filter (where c.verdict = 'live')::integer as live,
             count(*) filter (where c.verdict = 'pending')::integer as pending,
             count(*) filter (where c.verdict = 'being_worked')::integer as being_worked,
             count(*) filter (where c.verdict = 'capped')::integer as capped,
             count(*) filter (where c.verdict = 'outcome_not_in_rule')::integer as outcome_not_in_rule,
             count(*) filter (where c.verdict = 'owner_only')::integer as owner_only,
             count(*) filter (where c.verdict = 'too_recent')::integer as too_recent,
             count(*) filter (where c.verdict = 'eligible')::integer as eligible,
             count(*) filter (where c.verdict = 'eligible' and c.last_disposition = 'not_interested')::integer as eligible_said_no
        from recycle_lead_candidates(p_tenant_id, null, p_actor) c
       group by c.campaign_id
    ) g;
  return v_out;
end;
$function$;

revoke all on function public.tenant_recycle_pool(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_recycle_pool(uuid, uuid) to service_role;

-- ── start a batch ─────────────────────────────────────────────────────────
--
-- The 3-argument form is dropped: it moved leads before screening them and flagged the whole
-- campaign. Its only caller (lib/nurture/service.ts) now calls this one.
drop function if exists public.reactivate_nurture(uuid, uuid, uuid);

create or replace function public.reactivate_nurture(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_actor uuid,
  p_angle text,
  p_script text,
  p_attempt_ceiling integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_role text;
  v_wait integer;
  v_allowed text[];
  v_max integer;
  v_batch uuid;
  v_queued integer := 0;
  v_recent integer := 0;
  v_said_no integer := 0;
begin
  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  if not exists (select 1 from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'CAMPAIGN_NOT_FOUND';
  end if;
  if p_angle is null or char_length(btrim(p_angle)) < 3 or char_length(btrim(p_angle)) > 500 then
    raise exception using errcode = '22023', message = 'RECYCLE_ANGLE_REQUIRED';
  end if;
  if p_script is not null and char_length(p_script) > 5000 then
    raise exception using errcode = '22023', message = 'RECYCLE_SCRIPT_TOO_LONG';
  end if;
  if p_attempt_ceiling is null or p_attempt_ceiling < 1 or p_attempt_ceiling > 7 then
    raise exception using errcode = '22023', message = 'RECYCLE_CEILING_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recycle_batch:' || p_campaign_id::text, 0));
  if exists (select 1 from tenant_recycle_batches b
              where b.tenant_id = p_tenant_id and b.campaign_id = p_campaign_id and b.status = 'screening') then
    raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_OPEN';
  end if;

  select r.wait_days, r.allowed_dispositions, r.max_recycles into v_wait, v_allowed, v_max
    from tenant_campaign_recycle_rules r
   where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id;
  v_wait := coalesce(v_wait, 180);
  v_allowed := coalesce(v_allowed, array['no_answer', 'voicemail']::text[]);
  v_max := coalesce(v_max, 3);
  if v_max = 0 then
    raise exception using errcode = 'P0001', message = 'RECYCLE_CAP_ZERO';
  end if;

  insert into tenant_recycle_batches
    (tenant_id, campaign_id, angle, script, attempt_ceiling, wait_days, allowed_dispositions, max_recycles, cost_cents, created_by)
  values
    (p_tenant_id, p_campaign_id, btrim(p_angle), nullif(btrim(coalesce(p_script, '')), ''), p_attempt_ceiling, v_wait, v_allowed, v_max, 0, p_actor)
  returning id into v_batch;

  -- One pending reactivation per lead; no lead changes until its own screening clears. The
  -- recycle number is the lead's next, counting every earlier try (a failed screening included),
  -- so (lead_id, recycle_number) stays unique when a held lead is tried again.
  with pick as materialized (
    select c.lead_id, c.verdict, c.last_disposition
      from recycle_lead_candidates(p_tenant_id, p_campaign_id, p_actor) c
     where c.verdict in ('eligible', 'too_recent')
  ), ins as (
    insert into tenant_nurture_reactivations (tenant_id, lead_id, campaign_id, recycle_number, reason, batch_id)
    select p_tenant_id, pk.lead_id, p_campaign_id,
           coalesce((select max(nr.recycle_number) from tenant_nurture_reactivations nr where nr.lead_id = pk.lead_id), 0) + 1,
           'Waiting for a fresh suppression screening',
           v_batch
      from pick pk
     where pk.verdict = 'eligible'
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from pick where verdict = 'too_recent'),
         (select count(*) from pick where verdict = 'eligible' and last_disposition = 'not_interested')
    into v_queued, v_recent, v_said_no;

  if v_queued = 0 then
    -- Rolls the batch row back with it.
    raise exception using errcode = 'P0001', message = 'RECYCLE_NOTHING_ELIGIBLE';
  end if;

  update tenant_recycle_batches
     set queued = v_queued, excluded_too_recent = v_recent, said_no = v_said_no, last_progress_at = now()
   where id = v_batch;

  insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.recycle_batch_started', 'recycle_batch', v_batch::text,
          jsonb_build_object('tenantId', p_tenant_id, 'campaignId', p_campaign_id, 'queued', v_queued,
                             'excludedTooRecent', v_recent, 'saidNo', v_said_no,
                             'attemptCeiling', p_attempt_ceiling, 'angle', btrim(p_angle)));

  return jsonb_build_object('batch_id', v_batch, 'campaign_id', p_campaign_id, 'queued', v_queued,
                            'excluded_too_recent', v_recent, 'said_no', v_said_no,
                            'attempt_ceiling', p_attempt_ceiling);
end;
$function$;

revoke all on function public.reactivate_nurture(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.reactivate_nurture(uuid, uuid, uuid, text, text, integer) to service_role;

-- ── screen it, a chunk at a time ──────────────────────────────────────────

create or replace function public.recycle_batch_claim_chunk(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_actor uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_batch tenant_recycle_batches%rowtype;
  v_role text;
  v_stalled boolean;
  v_items jsonb;
  v_pending integer;
begin
  select * into v_batch from tenant_recycle_batches where id = p_batch_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECYCLE_BATCH_NOT_FOUND';
  end if;
  if v_batch.status <> 'screening' then
    return jsonb_build_object('done', true, 'items', '[]'::jsonb, 'pending', 0);
  end if;

  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  -- The person who started a batch drives it. Anyone else may pick it up only when it has made no
  -- progress for 15 minutes, and only an owner.
  v_stalled := v_batch.last_progress_at < now() - interval '15 minutes';
  if p_actor is distinct from v_batch.created_by then
    if v_role <> 'owner' then
      raise exception using errcode = '42501', message = 'RECYCLE_BATCH_NOT_YOURS';
    end if;
    if not v_stalled then
      raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_RUNNING';
    end if;
  end if;

  with picked as (
    select nr.id
      from tenant_nurture_reactivations nr
     where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending'
       and (nr.leased_until is null or nr.leased_until < now())
     order by nr.reactivated_at, nr.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), leased as (
    update tenant_nurture_reactivations nr
       set leased_until = now() + interval '5 minutes'
      from picked
     where nr.id = picked.id
    returning nr.id, nr.lead_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reactivation_id', le.id,
           'lead_id', le.lead_id,
           'phone', coalesce(l.values->>'phone', l.values->>'phone_number'))), '[]'::jsonb)
    into v_items
    from leased le
    join agent_leads l on l.id = le.lead_id and l.tenant_id = p_tenant_id;

  select count(*) into v_pending
    from tenant_nurture_reactivations nr
   where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending';

  return jsonb_build_object('done', false, 'items', v_items, 'pending', v_pending, 'stalled', v_stalled);
end;
$function$;

revoke all on function public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer) to service_role;

-- ── settle one lead ───────────────────────────────────────────────────────
--
-- 20260913450000's signature. The campaign's scrub_status is no longer written here at all.
create or replace function public.complete_nurture_reactivation(
  p_tenant_id uuid, p_reactivation_id uuid, p_status text, p_result_id uuid,
  p_outcome text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row tenant_nurture_reactivations%rowtype;
  v_ceiling integer;
  v_status text := p_status;
  v_reason text := p_reason;
  v_lead_state text;
  v_phone text;
  v_product text;
  v_pipeline uuid;
  v_stage uuid;
  v_item uuid;
  v_src_id uuid;
  v_src_partner uuid;
  v_src_product text;
  v_src_stage_key text;
  v_src_stage uuid;
  v_src_pipeline uuid;
  v_left integer;
begin
  if p_status not in ('cleared', 'blocked', 'failed') then
    raise exception 'REACTIVATION_STATUS_INVALID';
  end if;
  select * into v_row from tenant_nurture_reactivations
   where id = p_reactivation_id and tenant_id = p_tenant_id and status = 'pending'
   for update;
  if not found then
    raise exception 'REACTIVATION_NOT_FOUND';
  end if;
  if v_row.batch_id is not null then
    select b.attempt_ceiling into v_ceiling from tenant_recycle_batches b where b.id = v_row.batch_id for update;
  end if;

  select l.lead_state, nullif(btrim(coalesce(l.values->>'phone', l.values->>'phone_number', '')), ''),
         l.product_line, l.pipeline_id, l.stage_id
    into v_lead_state, v_phone, v_product, v_pipeline, v_stage
    from agent_leads l
   where l.id = v_row.lead_id and l.tenant_id = p_tenant_id
   for update;

  if v_status = 'cleared' then
    if v_lead_state is null then
      v_status := 'failed'; v_reason := 'The lead no longer exists.';
    elsif v_lead_state not in ('exhausted', 'closed', 'nurture') then
      v_status := 'failed';
      v_reason := format('The lead became %s while it was being screened, so it was left where it is.', v_lead_state);
    elsif coalesce((select s.suppressed from is_phone_suppressed(p_tenant_id, v_phone) s limit 1), false) then
      v_status := 'blocked'; v_reason := 'The number is on a suppression list now.';
    elsif exists (
      select 1 from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         and (q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
              or (q.status = 'unclaimed' and q.partner_id is not null))
    ) then
      v_status := 'failed'; v_reason := 'The lead has an open work item with someone, so it was left alone.';
    else
      -- The dialer item: reuse an open one (partner_id null), else a new one. Never a partner row:
      -- the inbox, the floor and the SLA ladder read partner_id, and a recycled lead is not a live
      -- transfer (Design 3). The partner row it came from is recorded so reopen_expired_lead
      -- closes this item before reopening that one.
      select q.id into v_item
        from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         and q.status = 'unclaimed' and q.partner_id is null
       limit 1;
      if v_item is null then
        select q.id, q.partner_id, q.product_line, q.stage_key, q.stage_id, q.pipeline_id
          into v_src_id, v_src_partner, v_src_product, v_src_stage_key, v_src_stage, v_src_pipeline
          from lead_queue q
         where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         order by q.queued_at desc nulls last, q.created_at desc
         limit 1;
        -- The lead and its work item sit in the same pipeline and stage (a board renders from both).
        if v_pipeline is null then
          v_pipeline := v_src_pipeline;
          v_stage := coalesce(v_stage, v_src_stage);
        end if;
        if coalesce(v_product, v_src_product) is null or v_pipeline is null then
          v_status := 'failed'; v_reason := 'The lead has no product line or pipeline, so it cannot be queued.';
        else
          insert into lead_queue
            (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier, nurtured_from_work_item_id)
          values
            (p_tenant_id, v_row.lead_id, coalesce(v_product, v_src_product), v_pipeline, v_stage,
             case when v_src_stage is not distinct from v_stage then coalesce(v_src_stage_key, 'new') else 'new' end,
             'unclaimed', 100,
             case when v_src_partner is not null then v_src_id end)
          returning id into v_item;
        end if;
      end if;

      if v_status = 'cleared' then
        update agent_leads
           set lead_state = 'nurture', attempts_made = 0, attempt_ceiling = v_ceiling,
               recycle_count = coalesce(recycle_count, 0) + 1,
               next_dial_after = now(), next_preferred_slot = null,
               last_reactivated_at = now(), nurture_entered_at = now(), updated_at = now()
         where id = v_row.lead_id and tenant_id = p_tenant_id;
        -- $0: the lead was paid for on its campaign already. Unique on (tenant, lead, campaign), so
        -- this lands only where the lead had no source row for its campaign.
        insert into tenant_lead_sources (tenant_id, lead_id, campaign_id, source_type, cost_cents, source_key)
        values (p_tenant_id, v_row.lead_id, v_row.campaign_id, 'recycle', 0,
                'recycle_batch:' || coalesce(v_row.batch_id::text, v_row.id::text))
        on conflict (tenant_id, lead_id, campaign_id) do nothing;
      end if;
    end if;
  end if;

  -- Blocked or failed: the lead is held where it was. One stranded by the old flow (nurture, due,
  -- with no work item) goes back to exhausted so it reads as what it is.
  if v_status <> 'cleared' and v_lead_state = 'nurture' then
    update agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null, updated_at = now()
     where id = v_row.lead_id and tenant_id = p_tenant_id and lead_state = 'nurture'
       and not exists (select 1 from lead_queue q where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
                        and q.status in ('unclaimed', 'claimed'));
  end if;

  update tenant_nurture_reactivations
     set status = v_status, screening_result_id = p_result_id, screening_outcome = p_outcome,
         reason = left(v_reason, 500), completed_at = now(), leased_until = null
   where id = v_row.id
  returning * into v_row;

  if v_row.batch_id is not null then
    update tenant_recycle_batches
       set cleared = cleared + (v_status = 'cleared')::integer,
           blocked = blocked + (v_status = 'blocked')::integer,
           failed = failed + (v_status = 'failed')::integer,
           last_progress_at = now()
     where id = v_row.batch_id;
    select count(*) into v_left from tenant_nurture_reactivations
     where batch_id = v_row.batch_id and status = 'pending';
    if v_left = 0 then
      update tenant_recycle_batches set status = 'complete', completed_at = now()
       where id = v_row.batch_id and status = 'screening';
      if found then
        insert into audit_log (actor_type, action, target_type, target_id, metadata)
        select 'system', 'tenant.recycle_batch_completed', 'recycle_batch', b.id::text,
               jsonb_build_object('tenantId', b.tenant_id, 'campaignId', b.campaign_id, 'queued', b.queued,
                                  'cleared', b.cleared, 'blocked', b.blocked, 'failed', b.failed)
          from tenant_recycle_batches b where b.id = v_row.batch_id;
      end if;
    end if;
  end if;

  return to_jsonb(v_row) || jsonb_build_object('work_item_id', v_item);
end;
$function$;

revoke all on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) to service_role;

-- ── what the batches did ──────────────────────────────────────────────────
--
-- Contacts and the rate use tenant_recycle_performance's own definitions (tenant_lead_activity:
-- contacts are dispositions other than the no-contact six, divided by clicked dials), so a
-- batch's rate and the fresh baseline beside it are the same measurement. A dial belongs to the
-- lead's latest cleared reactivation before it. Policies are issued rows after the reactivation.
create or replace function public.tenant_recycle_batch_report(
  p_tenant_id uuid,
  p_campaign_id uuid default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  with c as materialized (
    select nr.batch_id, nr.lead_id, nr.completed_at,
           (select min(n2.completed_at) from tenant_nurture_reactivations n2
             where n2.tenant_id = p_tenant_id and n2.lead_id = nr.lead_id and n2.status = 'cleared'
               and n2.completed_at > nr.completed_at) as until_at
      from tenant_nurture_reactivations nr
     where nr.tenant_id = p_tenant_id and nr.status = 'cleared' and nr.completed_at is not null
       and (p_campaign_id is null or nr.campaign_id = p_campaign_id)
  ),
  perf as materialized (
    select c.batch_id, c.lead_id,
           (select count(a.clicked_at) from tenant_lead_activity a
             where a.tenant_id = p_tenant_id and a.lead_id = c.lead_id and a.served_at >= c.completed_at
               and (c.until_at is null or a.served_at < c.until_at))::integer as dials,
           (select count(*) from tenant_lead_activity a
             where a.tenant_id = p_tenant_id and a.lead_id = c.lead_id and a.served_at >= c.completed_at
               and (c.until_at is null or a.served_at < c.until_at)
               and a.disposition is not null
               and a.disposition not in ('no_answer', 'voicemail', 'busy', 'call_dropped', 'wrong_number', 'disconnected'))::integer as contacts,
           (select count(*) from tenant_issued_policies ip
             where ip.tenant_id = p_tenant_id and ip.lead_id = c.lead_id and ip.status = 'issued'
               and ip.issued_at >= c.completed_at and (c.until_at is null or ip.issued_at < c.until_at))::integer as policies
      from c
  ),
  agg as (
    select pf.batch_id, sum(pf.dials)::integer as dials, sum(pf.contacts)::integer as contacts,
           count(*) filter (where pf.contacts > 0)::integer as leads_reached, sum(pf.policies)::integer as policies
      from perf pf
     where pf.batch_id is not null
     group by pf.batch_id
  ),
  recent as (
    select b.*
      from tenant_recycle_batches b
     where b.tenant_id = p_tenant_id and (p_campaign_id is null or b.campaign_id = p_campaign_id)
     order by b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 12), 50))
  )
  select jsonb_build_object(
    'batches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id, 'campaign_id', b.campaign_id, 'campaign_name', tc.name,
               'angle', b.angle, 'script', b.script, 'attempt_ceiling', b.attempt_ceiling,
               'status', b.status, 'created_at', b.created_at, 'completed_at', b.completed_at,
               'last_progress_at', b.last_progress_at,
               'stalled', b.status = 'screening' and b.last_progress_at < now() - interval '15 minutes',
               'created_by', b.created_by, 'created_by_name', u.name,
               'queued', b.queued, 'cleared', b.cleared, 'blocked', b.blocked, 'failed', b.failed,
               'pending', greatest(b.queued - b.cleared - b.blocked - b.failed, 0),
               'excluded_too_recent', b.excluded_too_recent, 'said_no', b.said_no,
               'cost_cents', b.cost_cents,
               'dials', coalesce(ag.dials, 0), 'contacts', coalesce(ag.contacts, 0),
               'leads_reached', coalesce(ag.leads_reached, 0), 'policies', coalesce(ag.policies, 0),
               'contact_rate_percent', case when coalesce(ag.dials, 0) > 0 then round(100.0 * ag.contacts / ag.dials, 1) end
             ) order by b.created_at desc), '[]'::jsonb)
        from recent b
        join tenant_campaigns tc on tc.id = b.campaign_id
        left join users u on u.id = b.created_by
        left join agg ag on ag.batch_id = b.id
    ),
    -- Every cleared reactivation, the ones from before batches existed included.
    'totals', (
      select jsonb_build_object(
               'recycled', count(*)::integer,
               'dials', coalesce(sum(pf.dials), 0)::integer,
               'contacts', coalesce(sum(pf.contacts), 0)::integer,
               'leads_reached', (count(*) filter (where pf.contacts > 0))::integer,
               'policies', coalesce(sum(pf.policies), 0)::integer,
               'contact_rate_percent', case when coalesce(sum(pf.dials), 0) > 0 then round(100.0 * sum(pf.contacts) / sum(pf.dials), 1) end)
        from perf pf
    )
  ) into v_out;
  return v_out;
end;
$function$;

revoke all on function public.tenant_recycle_batch_report(uuid, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_recycle_batch_report(uuid, uuid, integer) to service_role;

-- ── for the dialer: the pass a lead is on ─────────────────────────────────
--
-- The latest cleared reactivation that came from a batch, with its angle and script, and whether
-- the lead is still on that pass (in nurture, under the batch's ceiling). Null when never recycled
-- through a batch.
create or replace function public.lead_recycle_context(p_tenant_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'batch_id', b.id,
           'angle', b.angle,
           'script', b.script,
           'attempt_ceiling', b.attempt_ceiling,
           'recycle_number', nr.recycle_number,
           'recycled_at', nr.completed_at,
           'attempts_made', coalesce(l.attempts_made, 0),
           'current', l.lead_state in ('nurture', 'retry', 'working') and l.last_reactivated_at is not null
                      and l.last_reactivated_at >= nr.completed_at - interval '1 minute'
         )
    into v_out
    from tenant_nurture_reactivations nr
    join tenant_recycle_batches b on b.id = nr.batch_id
    join agent_leads l on l.id = nr.lead_id and l.tenant_id = p_tenant_id
   where nr.tenant_id = p_tenant_id and nr.lead_id = p_lead_id and nr.status = 'cleared'
   order by nr.completed_at desc
   limit 1;
  return v_out;
end;
$function$;

revoke all on function public.lead_recycle_context(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_recycle_context(uuid, uuid) to service_role;

-- ── assertions ────────────────────────────────────────────────────────────

do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.tenant_recycle_batches') is null then
    raise exception 'tenant_recycle_batches is missing';
  end if;
  if to_regprocedure('public.reactivate_nurture(uuid, uuid, uuid)') is not null then
    raise exception 'the 3-argument reactivate_nurture still exists; it moves leads before screening them';
  end if;
  if to_regprocedure('public.reactivate_nurture(uuid, uuid, uuid, text, text, integer)') is null
     or to_regprocedure('public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer)') is null
     or to_regprocedure('public.recycle_lead_candidates(uuid, uuid, uuid)') is null
     or to_regprocedure('public.tenant_recycle_pool(uuid, uuid)') is null
     or to_regprocedure('public.tenant_recycle_batch_report(uuid, uuid, integer)') is null
     or to_regprocedure('public.lead_recycle_context(uuid, uuid)') is null then
    raise exception 'a recycling function is missing';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_nurture_reactivation'
     and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_reactivation_id uuid, p_status text, p_result_id uuid, p_outcome text, p_reason text';
  if v_src is null then
    raise exception 'complete_nurture_reactivation is missing';
  end if;
  -- A screening never fails the campaign again.
  if v_src ~ 'update\s+(public\.)?tenant_campaigns' then
    raise exception 'complete_nurture_reactivation still writes tenant_campaigns';
  end if;
  -- A cleared lead gets a work item the dialer can serve.
  if v_src !~ 'insert into lead_queue' then
    raise exception 'complete_nurture_reactivation does not queue the cleared lead';
  end if;
  -- Design 3: the row it inserts never carries a partner_id, so the inbox, the floor and
  -- run_unclaimed_sla (all keyed on lead_queue.partner_id) never read it as a live transfer; and it
  -- never reuses a partner row.
  if v_src ~ 'insert into lead_queue\s*\([^)]*\mpartner_id\M' then
    raise exception 'complete_nurture_reactivation inserts a work item with a partner_id';
  end if;
  if v_src !~ 'q\.status = ''unclaimed'' and q\.partner_id is null' then
    raise exception 'complete_nurture_reactivation may reuse a partner work item';
  end if;
  if v_src !~ 'nurtured_from_work_item_id' then
    raise exception 'complete_nurture_reactivation does not point the item at the transfer it came from';
  end if;

  -- The eligibility rules live in SQL.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recycle_lead_candidates';
  if v_src !~ 'v_role <> ''owner''' or v_src !~ 'greatest\(p\.wait_days, 90\)' or v_src !~ 'is_phone_suppressed'
     or v_src !~ 'do_not_call' or v_src !~ 'next_dial_after > now\(\)' or v_src ~ 'updated_at' then
    raise exception 'recycle_lead_candidates lost one of its rules';
  end if;
  if v_src !~ 'q\.status = ''unclaimed'' and q\.partner_id is not null' then
    raise exception 'recycle_lead_candidates does not treat an open partner row as being worked';
  end if;

  -- The lead_queue itself is not changed by this file (no columns, no triggers).
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.lead_queue'::regclass
              and not t.tgisinternal and t.tgname like '%recycl%') then
    raise exception 'a recycling trigger was added to lead_queue';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925706500', 'recycle_batches_requeue_and_screening_by_lead') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/18] 20260925706600_recycled_lead_attempt_ceiling.sql ──────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Dialing cadence · a recycled lead stops at its batch's attempt ceiling
--
-- A recycle batch (20260925706500) sets agent_leads.attempt_ceiling on every lead it clears — the
-- board's "Attempts this pass", default 3. schedule_next_attempt is where a lead becomes exhausted,
-- so it is the one place that reads it: `v_ceiling := coalesce(v_lead_ceiling, 7)`. A lead with no
-- ceiling (every lead that was never recycled through a batch) behaves exactly as before.
--
-- The body is 20260924230300's, character for character, apart from the declaration, the select
-- and the one assignment marked 20260925706600. Signature, return type and grants unchanged.
-- complete_existing_dial_disposition (Dialer's) calls this and is not touched.
-- ---------------------------------------------------------------------------

alter table public.agent_leads add column if not exists attempt_ceiling integer;

create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_lead_ceiling integer;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_unused text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
  v_campaign_owns boolean := false;
  v_due timestamptz;
  v_zone text;
  v_last timestamptz;
  v_last_hour integer;
  v_from integer;
  v_to integer;
  v_t timestamptz;
  v_hour integer;
  v_here text;
  v_first timestamptz;
  v_first_slot text;
  v_found timestamptz;
  v_found_slot text;
  v_step integer;
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state', attempt_ceiling
    into v_made, v_campaign, v_state, v_lead_ceiling
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  -- 20260925706600: a recycled lead carries its batch's ceiling for this pass (default 3); every
  -- other lead has none and keeps the cadence's seven.
  v_ceiling := coalesce(v_lead_ceiling, v_ceiling);

  v_next := v_made + 1;

  -- The seventh dial is the last. `v_made` already counts the dial that was just dispositioned, so
  -- `v_made >= v_ceiling` means "seven dials have happened"; the old ceiling-minus-one stopped at six.
  -- The ceiling terminates rather than schedules: a date far in the future would still be served
  -- eventually by a queue that only checks whether the timer has elapsed.
  if v_made >= v_ceiling then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A campaign cadence replaces the tenant default entirely; the two are never merged.
  if v_campaign is not null then
    select exists (
      select 1 from tenant_cadence_rules r
       where r.tenant_id = p_tenant_id and r.campaign_id = v_campaign
    ) into v_campaign_owns;
  end if;

  -- A disposition-specific row beats the catch-all. "No-answer and voicemail should not behave
  -- identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (case when v_campaign_owns then r.campaign_id = v_campaign else r.campaign_id is null end)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when no rule covers this attempt.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
  end if;

  v_due := p_at + v_delay;

  -- Slots this lead has already been DIALLED in. `slot` is NOT NULL on the attempts table, but the
  -- filter is explicit anyway: a single null would make `not (s = any(v_tried))` evaluate to null
  -- for every candidate and silently empty `v_unused`, which would turn slot rotation off across
  -- the whole tenant without any error.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null;

  -- ── the board's three preferences: a part of the day, found inside the legal window ──
  if v_preferred in ('morning', 'evening', 'opposite_half') then
    select timezone into v_zone from state_timezones where state = upper(coalesce(v_state, ''));

    if v_zone is not null then
      select max(ca.attempted_at) into v_last
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
      v_last_hour := extract(hour from (coalesce(v_last, p_at) at time zone v_zone))::integer;

      v_from := case v_preferred
        when 'morning' then 0
        when 'evening' then 17
        else case when v_last_hour < 12 then 12 else 0 end
      end;
      v_to := case v_preferred
        when 'morning' then 12
        when 'evening' then 24
        else case when v_last_hour < 12 then 24 else 12 end
      end;

      v_t := v_due;
      -- 8 days of 15-minute steps. The legal-window check runs only on steps already inside the
      -- preferred hours, so an "evening" search asks it about 28 times a day, not 96.
      for v_step in 0 .. 768 loop
        v_hour := extract(hour from (v_t at time zone v_zone))::integer;
        if v_hour >= v_from and v_hour < v_to
           and tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_t) then
          v_here := current_slot_for_state(v_state, v_t);
          if v_first is null then
            v_first := v_t;
            v_first_slot := v_here;
          end if;
          -- Rotation still applies inside the preference: an untried slot wins if one comes up
          -- within a day of the first legal match.
          if v_here is not null and not (v_here = any(v_tried)) then
            v_found := v_t;
            v_found_slot := v_here;
            exit;
          end if;
          exit when v_t > v_first + interval '1 day';
        end if;
        -- The next quarter hour on the clock, so later steps land on :00, :15, :30, :45.
        v_t := date_trunc('hour', v_t)
               + make_interval(mins => ((floor(extract(minute from v_t) / 15)::integer + 1) * 15));
      end loop;

      if v_found is not null then
        return query select v_found, v_next, v_found_slot, false;
        return;
      elsif v_first is not null and v_first_slot is not null then
        return query select v_first, v_next, v_first_slot, false;
        return;
      end if;
    end if;

    -- No legal instant in the preferred part of the day within eight days, or no timezone for the
    -- lead's state: fall through to ordinary rotation from the floor rather than never calling.
    v_preferred := null;
  end if;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Every slot has been dialled. Decision 2: take the LEAST RECENTLY USED slot rather than
      -- blocking. `ca.slot` breaks ties so the answer is deterministic.
      select ca.slot into v_slot
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null
       group by ca.slot
       order by max(ca.attempted_at) asc, ca.slot asc
       limit 1;
      v_slot := coalesce(v_slot, v_available[1]);
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  -- The delay is a FLOOR, not an appointment: the serving query holds the lead back until the
  -- chosen slot actually arrives.
  return query select v_due, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706600: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt'
     and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_lead_id uuid, p_disposition text, p_at timestamp with time zone';
  if v_src is null then
    raise exception 'schedule_next_attempt is missing';
  end if;
  if v_src !~ 'v_ceiling := coalesce\(v_lead_ceiling, v_ceiling\)' or v_src !~ 'if v_made >= v_ceiling then' then
    raise exception 'schedule_next_attempt does not read the lead''s attempt ceiling';
  end if;
  -- 20260924230300's fixes survive.
  if v_src !~ 'tenant_can_dial_now\(p_tenant_id, v_state, v_campaign, v_t\)'
     or v_src !~ 'order by max\(ca\.attempted_at\) asc'
     or v_src ~ 'v_made >= v_ceiling - 1' then
    raise exception 'schedule_next_attempt lost a 20260924230300 fix';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925706600', 'recycled_lead_attempt_ceiling') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/18] 20260925707000_vendor_review_status_and_renewal.sql ───────────────────
begin;

-- ---------------------------------------------------------------------------
-- Vendors · a vendor can be under review, has a renewal date and a category label
--
-- User decisions (2026-09-25, Vendors concept board LA-2 §5):
--   * status gains 'under_review' beside 'active' and 'inactive'. It is STORED because it is a
--     person's judgement ("we are deciding whether to keep buying from them"). An under-review
--     vendor can still be given new campaigns — the screen warns, the database does not refuse.
--   * "Trialling" is NOT a status. It is derived (tenant_vendor_card, 20260925707100) from the
--     vendor's campaigns and leads, so it can never be left stale by someone forgetting to change it.
--   * renews_on: the contract renewal date, entered by hand. Nothing computes it and nothing acts on
--     it; the drop-recommendation facts quote it so the decision is made before the renewal, not after.
--   * category: a short free-text source label ("Direct mail responders", "Aged & ping-post").
--     lead_type stays the closed list/realtime/aged vocabulary the rest of the product keys on; the
--     label is for people and nothing branches on it.
--
-- Additive. The status check is replaced (drop + add under its own name), never loosened to free
-- text. Existing rows are all 'active' or 'inactive' and stay valid.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_vendors
  add column if not exists category text,
  add column if not exists renews_on date;

-- The column check from 20260913260000 was declared inline, so Postgres named it
-- tenant_lead_vendors_status_check. Any other check that constrains status is dropped too, so the
-- table ends with exactly one rule for it.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.tenant_lead_vendors'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.tenant_lead_vendors drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tenant_lead_vendors
  add constraint tenant_lead_vendors_status_check
  check (status in ('active', 'under_review', 'inactive'));

alter table public.tenant_lead_vendors drop constraint if exists tenant_lead_vendors_category_check;
alter table public.tenant_lead_vendors
  add constraint tenant_lead_vendors_category_check
  check (category is null or char_length(btrim(category)) between 1 and 80);

-- Column meanings (kept here rather than as COMMENT ON, which the parse-checker cannot see past
-- a privilege-blocked ADD COLUMN):
--   status     active | under_review | inactive. Trialling is derived by tenant_vendor_card.
--   renews_on  contract renewal date, entered by hand; quoted by the drop facts, acted on by nothing.
--   category   free-text source label for people; lead_type is the vocabulary code branches on.

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_defs text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_vendors' and column_name = 'renews_on' and data_type = 'date') then
    raise exception 'tenant_lead_vendors.renews_on is missing or not a date';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_vendors' and column_name = 'category') then
    raise exception 'tenant_lead_vendors.category is missing';
  end if;

  select count(*), string_agg(pg_get_constraintdef(c.oid), ' | ')
    into v_count, v_defs
    from pg_constraint c
   where c.conrelid = 'public.tenant_lead_vendors'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ~ '\mstatus\M';
  if v_count <> 1 then
    raise exception 'tenant_lead_vendors should have exactly one status check, found %: %', v_count, v_defs;
  end if;
  if strpos(v_defs, 'under_review') = 0 or strpos(v_defs, 'inactive') = 0 or strpos(v_defs, 'active') = 0 then
    raise exception 'tenant_lead_vendors status check does not allow active / under_review / inactive: %', v_defs;
  end if;
  -- Trialling is derived. If it ever becomes a stored status, the derivation and the column disagree.
  if strpos(v_defs, 'trial') > 0 then
    raise exception 'trialling must not be a stored vendor status';
  end if;

  if exists (select 1 from public.tenant_lead_vendors where status not in ('active', 'under_review', 'inactive')) then
    raise exception 'a vendor row carries a status outside the new rule';
  end if;
  raise notice '20260925707000: vendors can be under review, and carry a renewal date and a category label';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925707000', 'vendor_review_status_and_renewal') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/18] 20260925707100_tenant_vendor_card.sql ─────────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Vendors · tenant_vendor_card — the facts about a vendor that only the vendor owns
--
-- The Vendors roster on /app/campaigns shows, per vendor, figures that belong to four different
-- owners. Each is read from its one definition and never recomputed here:
--   cost per issued policy     Scorecard   tenant_vendor_scorecard_report → vendor_rows
--   claimable $ + days left    Returns     vendor_returns_candidates_summary
--   undialable share           Returns     vendor_dispute_rates
--   certificate coverage       Scorecard   tenant_vendor_consent_coverage
-- What is left is the vendor's own: its status, renewal date, category label, how many campaigns
-- and leads it has — and from those, whether it is still TRIALLING.
--
-- Trialling (user decision 2026-09-25): a vendor with at least one campaign, and EITHER a single
-- campaign OR fewer than 200 leads across its campaigns. 200 is the campaign comparison's own
-- "too few to tell apart" threshold (tenant_campaign_comparison, 20260913430000), reused so the
-- product has one idea of "not enough to judge". A trialling vendor is never ranked and never
-- flagged. A vendor with no campaigns is neither trialling nor ranked: there is nothing to judge.
--
-- Leads are agent_leads rows attributed to the vendor's campaigns, counted through
-- agent_leads_campaign_idx. Read-only (STABLE). Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_vendor_card(p_tenant_id uuid)
returns table(
  vendor_id uuid,
  status text,
  category text,
  renews_on date,
  campaign_count integer,
  lead_count integer,
  trial_lead_threshold integer,
  trialling boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  with campaigns as (
    select c.vendor_id, count(*)::integer as campaign_count
      from tenant_campaigns c
     where c.tenant_id = p_tenant_id
     group by c.vendor_id
  ),
  leads as (
    select c.vendor_id, count(l.id)::integer as lead_count
      from tenant_campaigns c
      join agent_leads l on l.tenant_id = c.tenant_id and l.campaign_id = c.id
     where c.tenant_id = p_tenant_id
     group by c.vendor_id
  )
  select v.id,
         v.status,
         v.category,
         v.renews_on,
         coalesce(k.campaign_count, 0),
         coalesce(n.lead_count, 0),
         200,
         coalesce(k.campaign_count, 0) >= 1
           and (coalesce(k.campaign_count, 0) = 1 or coalesce(n.lead_count, 0) < 200)
    from tenant_lead_vendors v
    left join campaigns k on k.vendor_id = v.id
    left join leads n on n.vendor_id = v.id
   where v.tenant_id = p_tenant_id
   order by v.name;
$function$;

revoke all on function public.tenant_vendor_card(uuid) from public, anon, authenticated;
grant execute on function public.tenant_vendor_card(uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_tenant uuid;
  v_row record;
  v_vendors integer;
  v_rows integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.tenant_vendor_card(uuid)'::regprocedure) into v_def;
  -- One idea of "not enough to judge": the comparison's 200.
  if strpos(v_def, '< 200') = 0 then
    raise exception 'tenant_vendor_card no longer uses the comparison''s 200-lead threshold';
  end if;
  if strpos(pg_get_functiondef('public.tenant_campaign_comparison(uuid, uuid, uuid, date, date, date, date, text)'::regprocedure), '< 200') = 0 then
    raise exception 'the campaign comparison changed its sample threshold; tenant_vendor_card must follow it';
  end if;

  -- One row per vendor of a real tenant, and the derivation holds on every row.
  select v.tenant_id into v_tenant from public.tenant_lead_vendors v limit 1;
  if v_tenant is not null then
    select count(*) into v_vendors from public.tenant_lead_vendors where tenant_id = v_tenant;
    select count(*) into v_rows from public.tenant_vendor_card(v_tenant);
    if v_rows <> v_vendors then
      raise exception 'tenant_vendor_card returned % rows for % vendors', v_rows, v_vendors;
    end if;
    for v_row in select * from public.tenant_vendor_card(v_tenant) loop
      if v_row.trialling <> (v_row.campaign_count >= 1 and (v_row.campaign_count = 1 or v_row.lead_count < 200)) then
        raise exception 'tenant_vendor_card: trialling disagrees with its own rule for vendor %', v_row.vendor_id;
      end if;
      if v_row.campaign_count = 0 and v_row.trialling then
        raise exception 'a vendor with no campaigns cannot be trialling';
      end if;
    end loop;
  end if;

  if not has_function_privilege('service_role', 'public.tenant_vendor_card(uuid)', 'execute') then
    raise exception 'service_role cannot execute tenant_vendor_card';
  end if;
  if has_function_privilege('anon', 'public.tenant_vendor_card(uuid)', 'execute') then
    raise exception 'anon can execute tenant_vendor_card';
  end if;
  raise notice '20260925707100: tenant_vendor_card answers status, renewal, category and whether a vendor is still trialling';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925707100', 'tenant_vendor_card') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/18] 20260925707500_vendor_returns_candidates_and_combined_claim.sql ───────
begin;

-- ---------------------------------------------------------------------------
-- Vendor returns · one list of what can be claimed, what it is worth, and one claim per campaign
--
-- Returns concept audit (LA-2 §15, 2026-09-25). User decisions:
--   * One claim per campaign combines the lead-based rows (a scrub hit on an imported lead, a call
--     dispositioned wrong number or disconnected) AND the rows the scrub removed at import, with a
--     preview first: count, dollars and evidence per reason, and a toggle per reason.
--   * The rate is the campaign's purchased cost per record — total_spend_cents / records_purchased —
--     exactly what create_vendor_return_claim (20260913440000) and create_import_removal_claim
--     (20260925703200) charge.
--   * Evidence carries the attempt number and time of a call, never the agent.
--
-- Three functions, service role only:
--
--   vendor_return_candidates(tenant, campaign?)
--       Every row that is or was claimable and is on no claim yet, from both sources, one row each:
--         source 'lead'    vendor_claimable_leads (Pool, latest 20260925703200) — NOT restated here.
--         source 'import'  tenant_campaign_scrub_rejections, filtered exactly as
--                          create_import_removal_claim filters: TCPA litigator, registry DNC,
--                          invalid, a repeat inside the file; never a hit on the agency's own
--                          do-not-call list; never a hit a later re-scrub found (source_key
--                          'scrub:<run>' — the number went onto the list after it was bought; the
--                          same rule 20260925707900 adds to Pool's two functions); not already on a
--                          claim, as a removal or as a lead of the same campaign with the same
--                          number. Window = rejected_at + the vendor's return_window_days.
--                          A lead whose screening hit came from such a re-scrub is not offered either.
--       One number, one claim: a lead whose number is also an unclaimed removal of the same campaign
--       (an imported-and-suppressed DNC row is both) is offered once, as the removal — it carries the
--       line of the vendor's file.
--       The import source exists only once 20260925703200 is applied (lead_claim_items can hold a
--       removal). Until then — to_regprocedure on Pool's create_import_removal_claim — this returns
--       the lead rows alone, which is today's behaviour.
--
--   vendor_returns_candidates_summary(tenant, vendor?, campaign?)
--       The ONE definition of claimable dollars and days left (Vendors aggregates it by vendor).
--       Per campaign: the window, the first import, the rate, claimable and expired rows and dollars,
--       the soonest close, and the same split per reason and source. Expired counts only when the
--       vendor has a return window at all: a 0-day vendor never accepted returns, nothing lapsed.
--
--   create_combined_vendor_return_claim(tenant, campaign, actor, reasons?)
--       Drafts one claim from the campaign's claimable candidates, optionally only some reasons, at
--       the purchased rate, and writes one audit row (tenant.vendor_claim_drafted). The claim is a
--       normal draft, submitted and resolved through update_vendor_return_claim.
--
-- Additive. Nothing existing is restated.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_return_candidates(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  source text,
  lead_id uuid,
  scrub_rejection_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  reason text,
  phone_digits text,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
#variable_conflict use_column
declare
  -- Removals can sit in the claim ledger only once Pool's 20260925703200 is applied.
  v_removals boolean := to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is not null;
begin
  if not v_removals then
    return query
      select 'lead'::text, k.lead_id, null::uuid, k.campaign_id, k.vendor_id, k.campaign_name, k.vendor_name,
             k.reason, right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10),
             k.evidence, k.claimable_until, k.days_remaining, k.claimable
        from public.vendor_claimable_leads(p_tenant_id, p_campaign_id) k
       -- Never a hit a later re-scrub found (see rescrub_numbers below).
       where k.source_type <> 'scrub'
          or (not exists (
                select 1 from public.tenant_campaign_scrub_rejections rs
                 where rs.tenant_id = p_tenant_id and rs.campaign_id = k.campaign_id
                   and rs.source_key like 'scrub:%'
                   and rs.phone_digits = right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
              )
              and not exists (
                select 1 from public.tenant_nurture_reactivations nr
                 where nr.tenant_id = p_tenant_id and nr.lead_id = k.lead_id
                   and nr.screening_result_id::text = k.evidence->>'screening_result_id'
              ));
    return;
  end if;

  return query
    with claimed_lead_numbers as (
      -- Numbers already claimed as a lead of a campaign: a removal of that campaign with the same
      -- number is the same person, already asked for.
      select distinct l.campaign_id as cid,
             right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) as digits
        from public.lead_claim_items i
        join public.agent_leads l on l.id = i.lead_id and l.tenant_id = i.tenant_id
       where i.tenant_id = p_tenant_id
         and i.lead_id is not null
         and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    ),
    claimed_removal_numbers as (
      -- And the other way: a number already claimed as a removal is not asked for again as a lead.
      -- vendor_claimable_leads (20260925703200) applies the same rule; restated here so the two
      -- sources cannot disagree whichever version of it is live.
      select distinct r.campaign_id as cid, r.phone_digits as digits
        from public.lead_claim_items i
        join public.tenant_campaign_scrub_rejections r on r.id = i.scrub_rejection_id and r.tenant_id = i.tenant_id
       where i.tenant_id = p_tenant_id
         and (p_campaign_id is null or r.campaign_id = p_campaign_id)
    ),
    removals as (
      select 'import'::text as src, null::uuid as lid, r.id as rid, r.campaign_id as cid, c.vendor_id as vid,
             c.name as cname, v.name as vname,
             case r.outcome when 'invalid' then 'invalid_phone' else r.outcome end as why,
             r.phone_digits as digits,
             -- The same evidence create_import_removal_claim writes, key for key.
             jsonb_build_object('source', 'import_removal', 'scrub_rejection_id', r.id, 'phone', r.phone_digits,
                                'outcome', r.outcome, 'detail', r.detail, 'source_row', r.source_key,
                                'occurrence', r.occurrence, 'rejected_at', r.rejected_at) as ev,
             r.rejected_at + make_interval(days => v.return_window_days) as until
        from public.tenant_campaign_scrub_rejections r
        join public.tenant_campaigns c on c.id = r.campaign_id and c.tenant_id = r.tenant_id
        join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = r.tenant_id
       where r.tenant_id = p_tenant_id
         and (p_campaign_id is null or r.campaign_id = p_campaign_id)
         and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
         -- The agency's own list is its decision, not the vendor's defect.
         and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
         -- Only a row recorded at import. A later re-scrub's hit ('scrub:<run>', 20260925706100)
         -- went onto the list after the number was bought (20260925707900).
         and coalesce(r.source_key, '') not like 'scrub:%'
         and not exists (
           select 1 from public.lead_claim_items i
            where i.tenant_id = p_tenant_id and i.scrub_rejection_id = r.id
         )
         and not exists (
           select 1 from claimed_lead_numbers n where n.cid = r.campaign_id and n.digits = r.phone_digits
         )
    ),
    rescrub_numbers as (
      -- Numbers a later re-scrub found (20260925706100). A lead whose screening hit came from one is
      -- not claimable; vendor_claimable_leads (20260925707900) says the same, restated here so this
      -- holds whichever version of it is live.
      select distinct rs.campaign_id as cid, rs.phone_digits as digits
        from public.tenant_campaign_scrub_rejections rs
       where rs.tenant_id = p_tenant_id
         and (p_campaign_id is null or rs.campaign_id = p_campaign_id)
         and rs.source_key like 'scrub:%'
    ),
    leads as (
      select 'lead'::text as src, k.lead_id as lid, null::uuid as rid, k.campaign_id as cid, k.vendor_id as vid,
             k.campaign_name as cname, k.vendor_name as vname, k.reason as why,
             right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10) as digits,
             k.evidence as ev, k.claimable_until as until
        from public.vendor_claimable_leads(p_tenant_id, p_campaign_id) k
       where k.source_type <> 'scrub'
          or (not exists (
                select 1 from rescrub_numbers n
                 where n.cid = k.campaign_id
                   and n.digits = right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
              )
              -- Nor a hit a nurture reactivation's re-screen stamped on the lead: the reactivation
              -- records the same screening_result_id it wrote onto the lead (20260925707900).
              and not exists (
                select 1 from public.tenant_nurture_reactivations nr
                 where nr.tenant_id = p_tenant_id and nr.lead_id = k.lead_id
                   and nr.screening_result_id::text = k.evidence->>'screening_result_id'
              ))
    ),
    unified as (
      select * from removals
      union all
      -- One number, one claim: offered as the removal when both exist.
      select l.* from leads l
       where l.digits = ''
          or (not exists (select 1 from removals r where r.cid = l.cid and r.digits = l.digits)
              and not exists (select 1 from claimed_removal_numbers n where n.cid = l.cid and n.digits = l.digits))
    )
    select u.src, u.lid, u.rid, u.cid, u.vid, u.cname, u.vname, u.why, u.digits, u.ev, u.until,
           greatest(0, floor(extract(epoch from (u.until - now())) / 86400))::integer,
           u.until > now()
      from unified u
     order by u.until asc, u.cid, u.src, u.digits;
end;
$function$;

create or replace function public.vendor_returns_candidates_summary(
  p_tenant_id uuid,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null
)
returns table(
  campaign_id uuid,
  campaign_name text,
  vendor_id uuid,
  vendor_name text,
  return_window_days integer,
  first_import_at timestamptz,
  unit_cost_cents numeric,
  claimable_rows integer,
  claimable_cents integer,
  expired_rows integer,
  expired_cents integer,
  soonest_closes_at timestamptz,
  days_left integer,
  reasons jsonb
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with cand as (
    select x.* from public.vendor_return_candidates(p_tenant_id, p_campaign_id) x
     where p_vendor_id is null or x.vendor_id = p_vendor_id
  ),
  camp as (
    select c.id, c.name, c.vendor_id, v.name as vname, coalesce(v.return_window_days, 0) as window_days,
           c.total_spend_cents::numeric / nullif(c.records_purchased, 0) as rate
      from public.tenant_campaigns c
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and c.id in (select distinct cand.campaign_id from cand)
  ),
  first_import as (
    select s.campaign_id as cid, min(s.created_at) as at
      from public.tenant_lead_sources s
     where s.tenant_id = p_tenant_id and s.source_type = 'import'
       and s.campaign_id in (select camp.id from camp)
     group by s.campaign_id
  ),
  per_reason as (
    select cand.campaign_id as cid, cand.reason, cand.source,
           count(*) filter (where cand.claimable)::integer as claimable_rows,
           count(*) filter (where not cand.claimable)::integer as expired_rows,
           min(cand.claimable_until) filter (where cand.claimable) as soonest
      from cand
     group by cand.campaign_id, cand.reason, cand.source
  ),
  per_campaign as (
    select p.cid,
           sum(p.claimable_rows)::integer as claimable_rows,
           sum(p.expired_rows)::integer as expired_rows,
           min(p.soonest) as soonest,
           jsonb_agg(jsonb_build_object(
             'reason', p.reason, 'source', p.source,
             'claimable_rows', p.claimable_rows,
             'claimable_cents', round(p.claimable_rows * coalesce(c.rate, 0))::integer,
             'expired_rows', case when c.window_days > 0 then p.expired_rows else 0 end,
             'expired_cents', case when c.window_days > 0 then round(p.expired_rows * coalesce(c.rate, 0))::integer else 0 end,
             'soonest_closes_at', p.soonest
           ) order by p.reason, p.source) as reasons
      from per_reason p
      join camp c on c.id = p.cid
     group by p.cid
  )
  select c.id, c.name, c.vendor_id, c.vname, c.window_days, f.at, c.rate,
         pc.claimable_rows,
         -- The amount the combined claim would ask for with every reason on: rows x rate, rounded once.
         round(pc.claimable_rows * coalesce(c.rate, 0))::integer,
         case when c.window_days > 0 then pc.expired_rows else 0 end,
         case when c.window_days > 0 then round(pc.expired_rows * coalesce(c.rate, 0))::integer else 0 end,
         pc.soonest,
         case when pc.soonest is null then null
              else greatest(0, floor(extract(epoch from (pc.soonest - now())) / 86400))::integer end,
         pc.reasons
    from per_campaign pc
    join camp c on c.id = pc.cid
    left join first_import f on f.cid = c.id
   where pc.claimable_rows > 0 or (c.window_days > 0 and pc.expired_rows > 0)
   order by pc.soonest asc nulls last, c.vname, c.name;
$function$;

create or replace function public.create_combined_vendor_return_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null,
  p_reasons text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_allowed constant text[] := array['wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'];
  v_vendor uuid;
  v_rate numeric;
  v_claim uuid;
  v_rows integer;
  v_lead_rows integer;
  v_removal_rows integer;
  v_amount integer;
  v_claim_reason text;
begin
  if p_reasons is not null then
    if cardinality(p_reasons) = 0 then raise exception 'LEAD_CLAIM_NO_REASON_CHOSEN'; end if;
    if not (p_reasons <@ v_allowed) then raise exception 'LEAD_CLAIM_REASON_INVALID'; end if;
  end if;

  -- Locked, as create_import_removal_claim locks it, so two presses (or this and the lead list's
  -- Claim button) cannot both draft the same rows.
  select c.vendor_id, c.total_spend_cents::numeric / nullif(c.records_purchased, 0)
    into v_vendor, v_rate
    from public.tenant_campaigns c
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id
     for update of c;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  create temporary table if not exists pg_temp.combined_claim_rows (
    source text, lead_id uuid, scrub_rejection_id uuid, reason text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.combined_claim_rows;

  insert into pg_temp.combined_claim_rows (source, lead_id, scrub_rejection_id, reason, evidence)
  select k.source, k.lead_id, k.scrub_rejection_id, k.reason, k.evidence
    from public.vendor_return_candidates(p_tenant_id, p_campaign_id) k
   where k.claimable
     and (p_reasons is null or k.reason = any (p_reasons));

  select count(*)::integer,
         count(*) filter (where x.source = 'lead')::integer,
         count(*) filter (where x.source = 'import')::integer,
         case when count(distinct x.reason) = 1 then min(x.reason) else 'mixed' end
    into v_rows, v_lead_rows, v_removal_rows, v_claim_reason
    from pg_temp.combined_claim_rows x;
  if v_rows = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;
  v_amount := round(v_rows * v_rate)::integer;

  insert into public.lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  values (p_tenant_id, p_campaign_id, v_vendor, v_claim_reason, v_rows, v_amount, p_created_by)
  returning id into v_claim;

  insert into public.lead_claim_items (claim_id, tenant_id, lead_id, reason, evidence)
  select v_claim, p_tenant_id, x.lead_id, x.reason, x.evidence
    from pg_temp.combined_claim_rows x
   where x.source = 'lead';

  -- Only reached when removals exist, which needs 20260925703200's scrub_rejection_id.
  if v_removal_rows > 0 then
    insert into public.lead_claim_items (claim_id, tenant_id, lead_id, scrub_rejection_id, reason, evidence)
    select v_claim, p_tenant_id, null, x.scrub_rejection_id, x.reason, x.evidence
      from pg_temp.combined_claim_rows x
     where x.source = 'import';
  end if;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_created_by, 'tenant.vendor_claim_drafted', 'lead_claim', v_claim::text, null,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'vendor_id', v_vendor,
            'claim_id', v_claim,
            'rows', v_rows,
            'lead_rows', v_lead_rows,
            'removal_rows', v_removal_rows,
            'amount_claimed_cents', v_amount,
            'reasons', coalesce(to_jsonb(p_reasons), '"all"'::jsonb)));

  return jsonb_build_object('claim_id', v_claim, 'rows', v_rows, 'lead_rows', v_lead_rows,
                            'removal_rows', v_removal_rows, 'amount_claimed_cents', v_amount);
end;
$function$;

revoke all on function public.vendor_return_candidates(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.vendor_returns_candidates_summary(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_return_candidates(uuid, uuid) to service_role;
grant execute on function public.vendor_returns_candidates_summary(uuid, uuid, uuid) to service_role;
grant execute on function public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[]) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_summary_rows bigint;
  v_candidate_rows bigint;
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is null
     or to_regprocedure('public.vendor_returns_candidates_summary(uuid, uuid, uuid)') is null
     or to_regprocedure('public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[])') is null then
    raise exception '20260925707500: a vendor returns function did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.vendor_returns_candidates_summary(uuid, uuid, uuid)', 'execute') then
    raise exception '20260925707500: vendor returns functions must be service-role only';
  end if;
  -- The removal filter is Pool's, word for word where it matters.
  if strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707500: own-list DNC hits would be claimed against the vendor';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is not null
     and strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707500: create_import_removal_claim no longer excludes own-list DNC — the two filters disagree';
  end if;

  -- The summary is the candidates, counted: nothing added, nothing lost, dollars = rows x rate.
  select c.tenant_id into v_tenant
    from public.tenant_campaigns c
   where c.records_purchased > 0
   limit 1;
  if v_tenant is null then
    raise notice '20260925707500: behavioural check skipped, no vendor campaign in this database';
    return;
  end if;
  select coalesce(sum(s.claimable_rows), 0) into v_summary_rows from public.vendor_returns_candidates_summary(v_tenant) s;
  select count(*) into v_candidate_rows from public.vendor_return_candidates(v_tenant) k where k.claimable;
  if v_summary_rows <> v_candidate_rows then
    raise exception '20260925707500: summary counts % claimable rows, candidates %', v_summary_rows, v_candidate_rows;
  end if;
  select count(*) into v_bad from public.vendor_returns_candidates_summary(v_tenant) s
   where s.claimable_cents <> round(s.claimable_rows * coalesce(s.unit_cost_cents, 0));
  if v_bad > 0 then
    raise exception '20260925707500: % campaign(s) whose claimable dollars are not rows x purchased rate', v_bad;
  end if;
  raise notice '20260925707500: % claimable row(s) for the first vendor tenant, summary agrees', v_candidate_rows;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925707500', 'vendor_returns_candidates_and_combined_claim') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/18] 20260925707800_vendor_undialable_rates.sql ────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Vendor returns · the share of every record bought from a vendor that could never be dialed
--
-- Returns concept audit (LA-2 §15, 2026-09-25). User decision: an UNDIALABLE share per vendor, with
-- records purchased as the denominator — every record paid for, including the rows the scrub
-- removed at import, which never became leads. Labelled "undialable", never blended with the claim
-- acceptance rate (decision 11 of the vendor scorecard; lib/vendorScorecard/metricDirections.test.mjs
-- refuses the old blended name anywhere in the code).
--
-- Undialable, per campaign, then summed per vendor (sum then divide, never an average of averages):
--
--   removed_at_import   tenant_campaign_scrub_rejections rows the vendor is answerable for — TCPA
--                       litigator, registry DNC, invalid, a repeat inside the file. The same set
--                       vendor_return_candidates (20260925707500) and create_import_removal_claim
--                       (20260925703200) treat as creditable. A hit on the agency's own
--                       do-not-call list and a 'suppressed' row are the agency's decision, not the
--                       vendor's defect, and are not counted. Nor is a hit a later re-scrub
--                       found (source_key 'scrub:<run>', 20260925706100): that number went onto a
--                       list after it was bought (20260925707900). Those rows still lower the
--                       usable count for cost per usable record; they are just not the vendor's.
--   undialable_leads    imported leads later found undialable: a registry DNC or litigator screening
--                       result (screening_results — an own-list hit has no result row) that no
--                       re-scrub found, or a call
--                       dispositioned wrong number or disconnected. A lead whose number is also a
--                       counted removal of the same campaign is counted once, as the removal.
--   undialable_cents    those rows at the campaign's purchased cost per record.
--
-- The Vendors page reads this (contract: one definition). Read-only (STABLE), service role only.
-- Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_undialable_rates(
  p_tenant_id uuid,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
  vendor_name text,
  records_purchased integer,
  removed_at_import integer,
  undialable_leads integer,
  undialable_rows integer,
  undialable_percent numeric,
  undialable_cents integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with camp as (
    select c.id, c.vendor_id, v.name as vname, c.records_purchased as purchased,
           c.total_spend_cents::numeric / nullif(c.records_purchased, 0) as rate
      from public.tenant_campaigns c
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_vendor_id is null or c.vendor_id = p_vendor_id)
  ),
  removed as (
    select distinct r.campaign_id as cid, r.phone_digits as digits, r.id
      from public.tenant_campaign_scrub_rejections r
     where r.tenant_id = p_tenant_id
       and r.campaign_id in (select camp.id from camp)
       and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
       and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
       -- Recorded at import only. A later re-scrub's hit ('scrub:<run>') is a number that went onto
       -- a list after it was bought — not the vendor's defect (20260925707900).
       and coalesce(r.source_key, '') not like 'scrub:%'
  ),
  rescrub as (
    select distinct rs.campaign_id as cid, rs.phone_digits as digits
      from public.tenant_campaign_scrub_rejections rs
     where rs.tenant_id = p_tenant_id
       and rs.campaign_id in (select camp.id from camp)
       and rs.source_key like 'scrub:%'
  ),
  lead_numbers as (
    select l.id, l.tenant_id, l.campaign_id as cid, sr.outcome as screened, l.screening_result_id as result_id,
           right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) as digits
      from public.agent_leads l
      left join public.screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and l.campaign_id in (select camp.id from camp)
  ),
  bad_leads as (
    select ln.id, ln.cid, ln.digits
      from lead_numbers ln
     where (ln.screened in ('dnc', 'tcpa_litigator')
            -- a registry hit a later re-scrub found is not the vendor's defect
            and not exists (select 1 from rescrub rx where rx.cid = ln.cid and rx.digits = ln.digits)
            -- nor one a nurture reactivation's re-screen stamped on the lead (same result id)
            and not exists (select 1 from public.tenant_nurture_reactivations nr
                             where nr.tenant_id = ln.tenant_id and nr.lead_id = ln.id
                               and nr.screening_result_id = ln.result_id))
        or exists (
             select 1 from public.tenant_call_attempts a
              where a.tenant_id = ln.tenant_id and a.lead_id = ln.id
                and a.disposition in ('wrong_number', 'disconnected')
           )
  ),
  per_campaign as (
    select c.id, c.vendor_id, c.vname, c.purchased, c.rate,
           coalesce(r.n, 0) as removed_n,
           coalesce(b.n, 0) as lead_n
      from camp c
      left join (select removed.cid, count(*)::integer as n from removed group by removed.cid) r on r.cid = c.id
      left join (
        select bl.cid, count(*)::integer as n
          from bad_leads bl
         where bl.digits = ''
            or not exists (select 1 from removed rm where rm.cid = bl.cid and rm.digits = bl.digits)
         group by bl.cid
      ) b on b.cid = c.id
  )
  select p.vendor_id, min(p.vname),
         sum(p.purchased)::integer,
         sum(p.removed_n)::integer,
         sum(p.lead_n)::integer,
         sum(p.removed_n + p.lead_n)::integer,
         round(100.0 * sum(p.removed_n + p.lead_n) / nullif(sum(p.purchased), 0), 1),
         round(sum((p.removed_n + p.lead_n) * coalesce(p.rate, 0)))::integer
    from per_campaign p
   group by p.vendor_id
   order by round(100.0 * sum(p.removed_n + p.lead_n) / nullif(sum(p.purchased), 0), 1) desc nulls last, min(p.vname);
$function$;

revoke all on function public.vendor_undialable_rates(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_undialable_rates(uuid, uuid) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707800: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is null then
    raise exception '20260925707800: vendor_undialable_rates did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.vendor_undialable_rates(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.vendor_undialable_rates(uuid, uuid)', 'execute') then
    raise exception '20260925707800: vendor_undialable_rates must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707800: own-list DNC hits would count against the vendor';
  end if;

  select c.tenant_id into v_tenant from public.tenant_campaigns c where c.records_purchased > 0 limit 1;
  if v_tenant is null then
    raise notice '20260925707800: behavioural check skipped, no campaign with records purchased';
    return;
  end if;
  -- The parts add up, and a share exists exactly when something was bought.
  select count(*) into v_bad from public.vendor_undialable_rates(v_tenant) u
   where u.undialable_rows <> u.removed_at_import + u.undialable_leads
      or (u.records_purchased > 0) <> (u.undialable_percent is not null);
  if v_bad > 0 then
    raise exception '20260925707800: % vendor row(s) whose undialable parts do not add up', v_bad;
  end if;
  raise notice '20260925707800: undialable share per vendor over records purchased';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925707800', 'vendor_undialable_rates') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/18] 20260925707900_rescrub_hits_are_never_claimable.sql ───────────────────
begin;

-- ---------------------------------------------------------------------------
-- Vendor returns · a number that failed a LATER re-scrub is never claimed from the vendor
--
-- User decision (2026-09-25, Returns + Campaigns): "Run the scrub" (20260925706100,
-- lib/campaigns/scrubRun.ts) re-screens a campaign's leads and writes each new DNC / litigator hit
-- into the same ledger the import uses, tenant_campaign_scrub_rejections, with
-- source_key = 'scrub:<run id>' — and stamps the lead's screening columns with the new result. A
-- number that went onto a do-not-call list AFTER it was bought is not the vendor's defect. Only a row
-- recorded at import (source_key 'csv:<line>', or none) can be claimed.
--
-- The rows still count as unusable: tenant_campaign_costs.records_usable is purchased minus every
-- ledger row (20260917140000), and nothing here touches it. They just cannot be claimed.
--
-- Restated from their latest definitions, 20260925703200 (Pool, final), with that one exclusion and
-- nothing else changed:
--
--   vendor_claimable_leads         the scrub branch drops a lead whose number has a 'scrub:' ledger
--                                  row in its campaign (the re-scrub is what put the hit on the lead),
--                                  and a lead whose screening result was stamped by a nurture
--                                  reactivation's re-screen (tenant_nurture_reactivations records the
--                                  same screening_result_id it writes onto the lead — the exact link;
--                                  the column exists since 20260913450000, so nothing here waits on
--                                  20260925706500). Same rule: a DNC found by any screening after
--                                  purchase is not the vendor's defect. The wrong_number /
--                                  disconnected branch is unchanged.
--   create_import_removal_claim    drops ledger rows whose source_key starts 'scrub:'.
--
-- Same signatures, same grants (service role only). Returns' own functions (20260925707500,
-- 20260925707800) apply the same rule in their own bodies. Every assertion of 20260925703200 is
-- kept below, plus one for the new exclusion.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_claimable_leads(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  lead_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  lead_created_at timestamptz,
  reason text,
  source_type text,
  source_id uuid,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select l.id as lead_id, l.campaign_id, c.vendor_id, c.name as campaign_name, v.name as vendor_name,
           l.created_at as lead_created_at,
            case coalesce(sr.outcome, l.screening_outcome) when 'dnc' then 'dnc' when 'tcpa_litigator' then 'tcpa_litigator' else 'invalid_phone' end as reason,
           'scrub'::text as source_type, l.screening_result_id as source_id,
           jsonb_build_object('source', 'scrub', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'screening_outcome', coalesce(sr.outcome, l.screening_outcome),
             'screening_result_id', l.screening_result_id, 'screening_checked_at', l.screening_checked_at,
             'screening_version', l.screening_version) as evidence,
           l.created_at + make_interval(days => v.return_window_days) as claimable_until,
           1 as priority
       from agent_leads l
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
       and coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone')
       -- A hit on the agency's OWN do-not-call list is stored as 'dnc' with no screening result
       -- (lib/compliance/screening.ts): it is the agency's decision, not the vendor's defect, and is
       -- never charged back. Only a registry hit — one with a screening result — is.
       and not (coalesce(sr.outcome, l.screening_outcome) = 'dnc' and l.screening_result_id is null)
       -- A hit found by a later re-scrub (source_key 'scrub:<run>', 20260925706100) is not the
       -- vendor's defect either: the number went onto the list after it was bought (20260925707900).
       and not exists (
         select 1 from tenant_campaign_scrub_rejections rs
          where rs.tenant_id = l.tenant_id
            and rs.campaign_id = l.campaign_id
            and rs.source_key like 'scrub:%'
            and rs.phone_digits = right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10)
       )
       -- Nor a hit a nurture reactivation's re-screen stamped on the lead (lib/nurture/service.ts,
       -- complete_nurture_reactivation — 20260913450000, restated by 20260925706500). The exact link:
       -- the reactivation row records the same screening_result_id it wrote onto the lead.
       and not exists (
         select 1 from tenant_nurture_reactivations nr
          where nr.tenant_id = l.tenant_id
            and nr.lead_id = l.id
            and nr.screening_result_id = l.screening_result_id
       )
    union all
    select l.id, l.campaign_id, c.vendor_id, c.name, v.name, l.created_at,
           a.disposition, 'disposition', a.id,
           jsonb_build_object('source', 'disposition', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'disposition', a.disposition,
             'attempt_id', a.id, 'attempted_at', a.attempted_at, 'dial_clicked_at', a.dial_clicked_at,
             'attempt_number', a.attempt_number) as evidence,
           l.created_at + make_interval(days => v.return_window_days), 2
      from agent_leads l
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
      join lateral (
        select a.* from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.disposition in ('wrong_number', 'disconnected')
         order by a.attempted_at desc, a.id desc limit 1
      ) a on true
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  one_per_lead as (
    select distinct on (lead_id) * from candidates
     where not exists (
       select 1 from lead_claim_items i join lead_claims cl on cl.id = i.claim_id
        where i.tenant_id = p_tenant_id and i.lead_id = candidates.lead_id
     )
       -- One number, one claim: not a lead whose number this campaign already claimed as an
       -- import removal (20260925703200).
       and not exists (
         select 1 from lead_claim_items ri
           join tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
          where ri.tenant_id = p_tenant_id
            and r.tenant_id = p_tenant_id
            and r.campaign_id = candidates.campaign_id
            and r.phone_digits = right(regexp_replace(coalesce(candidates.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
       )
     order by lead_id, priority, claimable_until desc
  )
  select lead_id, campaign_id, vendor_id, campaign_name, vendor_name, lead_created_at, reason,
         source_type, source_id, evidence, claimable_until,
         greatest(0, floor(extract(epoch from (claimable_until - now())) / 86400))::integer as days_remaining,
         claimable_until > now() as claimable
    from one_per_lead
   order by claimable_until asc, lead_created_at asc;
$function$;

create or replace function public.create_import_removal_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_vendor uuid;
  v_window integer;
  v_rate numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_claim uuid;
  v_rows integer;
  v_amount integer;
  v_claim_reason text;
begin
  if v_reason is not null and v_reason not in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file') then
    raise exception 'LEAD_CLAIM_REASON_INVALID';
  end if;

  -- The campaign row is locked so two presses cannot both draft the same rows; the partial unique
  -- index on lead_claim_items would refuse the second anyway, but as an error rather than a no-op.
  select c.vendor_id, c.total_spend_cents::numeric / nullif(c.records_purchased, 0), v.return_window_days
    into v_vendor, v_rate, v_window
    from tenant_campaigns c
    join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id
     for update of c;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  create temporary table if not exists pg_temp.import_removal_claim_rows (
    id uuid, phone_digits text, reason text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.import_removal_claim_rows;

  insert into pg_temp.import_removal_claim_rows (id, phone_digits, reason, evidence)
  select r.id, r.phone_digits,
         case r.outcome when 'invalid' then 'invalid_phone' else r.outcome end,
         jsonb_build_object('source', 'import_removal', 'scrub_rejection_id', r.id, 'phone', r.phone_digits,
                            'outcome', r.outcome, 'detail', r.detail, 'source_row', r.source_key,
                            'occurrence', r.occurrence, 'rejected_at', r.rejected_at)
    from tenant_campaign_scrub_rejections r
   where r.tenant_id = p_tenant_id
     and r.campaign_id = p_campaign_id
     and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
     -- The agency's own list is its decision, not the vendor's defect.
     and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
     -- Only a row recorded at import: a later re-scrub's hit ('scrub:<run>') went onto the list
     -- after the number was bought (20260925707900).
     and coalesce(r.source_key, '') not like 'scrub:%'
     and (v_reason is null or r.outcome = v_reason)
     and r.rejected_at + make_interval(days => v_window) > now()
     and not exists (
       select 1 from lead_claim_items i where i.tenant_id = p_tenant_id and i.scrub_rejection_id = r.id
     )
     -- Already claimed as a lead of this campaign (an imported-and-suppressed DNC row is both).
     and not exists (
       select 1 from lead_claim_items i
         join agent_leads l on l.id = i.lead_id and l.tenant_id = i.tenant_id
        where i.tenant_id = p_tenant_id
          and l.campaign_id = p_campaign_id
          and right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) = r.phone_digits
     );

  select count(*)::integer, round(count(*) * v_rate)::integer,
         case when count(distinct reason) = 1 then min(reason) else 'mixed' end
    into v_rows, v_amount, v_claim_reason
    from pg_temp.import_removal_claim_rows;
  if v_rows = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;

  insert into lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  values (p_tenant_id, p_campaign_id, v_vendor, v_claim_reason, v_rows, v_amount, p_created_by)
  returning id into v_claim;

  insert into lead_claim_items (claim_id, tenant_id, lead_id, scrub_rejection_id, reason, evidence)
  select v_claim, p_tenant_id, null, x.id, x.reason, x.evidence
    from pg_temp.import_removal_claim_rows x;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_created_by, 'tenant.vendor_claim_drafted_from_import', 'lead_claim', v_claim::text, null,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'vendor_id', v_vendor,
            'claim_id', v_claim,
            'rows', v_rows,
            'amount_claimed_cents', v_amount,
            'reason', coalesce(v_reason, 'all')));

  return jsonb_build_object('claim_id', v_claim, 'rows', v_rows, 'amount_claimed_cents', v_amount);
end;
$function$;

revoke all on function public.create_import_removal_claim(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.create_import_removal_claim(uuid, uuid, uuid, text) to service_role;
revoke all on function public.vendor_claimable_leads(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_claimable_leads(uuid, uuid) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707900: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- 20260925703200's assertions, kept.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id') then
    raise exception '20260925707900: lead_claim_items.scrub_rejection_id was not added';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'lead_id' and is_nullable = 'NO') then
    raise exception '20260925707900: lead_claim_items.lead_id is still not null';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    raise exception '20260925707900: an item must name exactly one of a lead or a removal';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lead_claim_items_scrub_rejection_key') then
    raise exception '20260925707900: a removal could be claimed twice';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is null then
    raise exception '20260925707900: create_import_removal_claim was not created';
  end if;
  if has_function_privilege('anon', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute') then
    raise exception '20260925707900: create_import_removal_claim must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'scrub_rejection_id') = 0 then
    raise exception '20260925707900: vendor_claimable_leads does not exclude numbers claimed as removals';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure),
            'and not (coalesce(sr.outcome, l.screening_outcome) = ''dnc'' and l.screening_result_id is null)') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers hits on the agency''s own do-not-call list to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception '20260925707900: vendor_claimable_leads lost the wrong-number / disconnected branch';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707900: create_import_removal_claim claims hits on the agency''s own list';
  end if;

  -- The new exclusion, in both functions and in Returns' own.
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'rs.source_key like ''scrub:%''') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers a re-scrub hit to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'nr.screening_result_id = l.screening_result_id') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers a nurture re-screen''s DNC hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'tenant_nurture_reactivations') = 0 then
    raise exception '20260925707900: vendor_return_candidates offers a nurture re-screen''s DNC hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'tenant_nurture_reactivations') = 0 then
    raise exception '20260925707900: vendor_undialable_rates counts a nurture re-screen''s DNC hit against the vendor';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'not like ''scrub:%''') = 0 then
    raise exception '20260925707900: create_import_removal_claim claims a re-scrub hit from the vendor';
  end if;
  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'scrub:%') = 0 then
    raise exception '20260925707900: vendor_return_candidates offers a re-scrub hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'scrub:%') = 0 then
    raise exception '20260925707900: vendor_undialable_rates counts a re-scrub hit against the vendor';
  end if;
  raise notice '20260925707900: only rows recorded at import can be claimed from the vendor';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925707900', 'rescrub_hits_are_never_claimable') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/18] 20260925708000_scorecard_test_batch_and_policy_lapse.sql ──────────────
begin;

-- ---------------------------------------------------------------------------
-- Scorecard (LA-2 §14 concept) · two columns the vendor scorecard needs
--
-- 1. tenant_campaigns.is_test_batch
--    A trial buy — "500 records to see what they are like" — is not comparable with a committed
--    buy. User decision: a MANUAL flag, set on the campaign (the Campaigns page owns the toggle and
--    its PATCH field). The scorecard shows the row with a "Test batch" chip and keeps it out of the
--    ranking; nothing else changes because of it — the leads still dial, the spend still counts in
--    the totals.
--
-- 2. tenant_issued_policies.lapsed_at
--    "Issued & persisting 60 days" needs to know WHEN a policy stopped being in force, not only
--    that it did: a policy that lapsed on day 200 persisted 60 days, one that lapsed on day 20 did
--    not. The status column alone cannot tell them apart. Written by mark_issued_policy_lapsed
--    (20260925708300) and never before the issue date.
--
-- Additive and idempotent. No backfill: every existing campaign is a committed buy until someone
-- says otherwise, and the live policy table has no rows (20260922190000 measured 0).
-- ---------------------------------------------------------------------------

alter table public.tenant_campaigns
  add column if not exists is_test_batch boolean not null default false;

alter table public.tenant_issued_policies
  add column if not exists lapsed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_issued_policies'::regclass
       and conname = 'tenant_issued_policies_lapse_after_issue'
  ) then
    alter table public.tenant_issued_policies
      add constraint tenant_issued_policies_lapse_after_issue
      check (lapsed_at is null or lapsed_at >= issued_at);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_issued_policies'::regclass
       and conname = 'tenant_issued_policies_lapse_matches_status'
  ) then
    -- A lapse date on a live policy would make it count as persisting and as lapsed at once.
    alter table public.tenant_issued_policies
      add constraint tenant_issued_policies_lapse_matches_status
      check (status <> 'issued' or lapsed_at is null);
  end if;
end $$;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_campaigns'
                    and column_name = 'is_test_batch' and data_type = 'boolean' and is_nullable = 'NO') then
    raise exception 'tenant_campaigns.is_test_batch did not land';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_issued_policies'
                    and column_name = 'lapsed_at') then
    raise exception 'tenant_issued_policies.lapsed_at did not land';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.tenant_issued_policies'::regclass
         and conname in ('tenant_issued_policies_lapse_after_issue', 'tenant_issued_policies_lapse_matches_status')) <> 2 then
    raise exception 'the lapse checks on tenant_issued_policies did not land';
  end if;
  raise notice '20260925708000: is_test_batch and lapsed_at are in place';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708000', 'scorecard_test_batch_and_policy_lapse') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [12/18] 20260925708100_consent_coverage_counts_each_lead_once.sql ─────────────
begin;

-- ---------------------------------------------------------------------------
-- Scorecard · consent coverage counts each lead once
--
-- tenant_vendor_consent_coverage (20260913320000) joins every lead to its certificates and then
-- counts joined rows. tenant_consent_artefacts allows one certificate PER PROVIDER per lead
-- (unique (tenant_id, lead_id, provider)), so a lead that arrived with both a TrustedForm and a
-- Jornaya certificate was two "leads" and two "certificates". A vendor whose every lead carries
-- both read correctly by accident; a vendor with a mix read wrong in both the numerator and the
-- denominator.
--
-- Now every figure is a count of distinct LEADS:
--   leads                 leads attributed to the vendor
--   claimed_certificates  leads with at least one claimed (stored) certificate
--   any_certificate       leads with at least one certificate in any capture state
-- Same columns, same types, same order, so `create or replace` keeps the view and its dependants.
-- /app/campaigns and True CPA both read this one view.
-- ---------------------------------------------------------------------------

create or replace view public.tenant_vendor_consent_coverage as
select
  v.tenant_id,
  v.id as vendor_id,
  v.name as vendor_name,
  count(distinct l.id)::integer as leads,
  count(distinct l.id) filter (where a.capture_status = 'claimed')::integer as claimed_certificates,
  count(distinct l.id) filter (where a.id is not null)::integer as any_certificate,
  round(
    100.0 * count(distinct l.id) filter (where a.capture_status = 'claimed') / nullif(count(distinct l.id), 0), 1
  ) as claimed_coverage_pct,
  round(
    100.0 * count(distinct l.id) filter (where a.id is not null) / nullif(count(distinct l.id), 0), 1
  ) as any_coverage_pct
from public.tenant_lead_vendors v
left join public.tenant_campaigns c on c.vendor_id = v.id and c.tenant_id = v.tenant_id
left join public.agent_leads l on l.campaign_id = c.id and l.tenant_id = v.tenant_id
left join public.tenant_consent_artefacts a on a.lead_id = l.id and a.tenant_id = v.tenant_id
group by v.tenant_id, v.id, v.name;

-- Re-stated rather than trusted to survive: without security_invoker every tenant reads every
-- other tenant's coverage through this view.
alter view public.tenant_vendor_consent_coverage set (security_invoker = on);
revoke all on public.tenant_vendor_consent_coverage from anon, authenticated, public;
grant select on public.tenant_vendor_consent_coverage to tenant_app, service_role;

do $$
declare
  v_def text;
  v_options text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_def := pg_get_viewdef('public.tenant_vendor_consent_coverage'::regclass);
  if v_def !~* 'count\(DISTINCT l\.id\)' then
    raise exception 'tenant_vendor_consent_coverage still counts joined rows, not leads';
  end if;
  select c.reloptions into v_options from pg_class c where c.oid = 'public.tenant_vendor_consent_coverage'::regclass;
  if v_options is null or not ('security_invoker=on' = any (v_options) or 'security_invoker=true' = any (v_options)) then
    raise exception 'tenant_vendor_consent_coverage lost security_invoker';
  end if;
  if has_table_privilege('anon', 'public.tenant_vendor_consent_coverage', 'select') then
    raise exception 'anon can read consent coverage';
  end if;
  raise notice '20260925708100: consent coverage counts each lead once';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708100', 'consent_coverage_counts_each_lead_once') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [13/18] 20260925708200_vendor_scorecard_ranks_vendors_by_cost_per_policy.sql ───
begin;

-- ---------------------------------------------------------------------------
-- Scorecard (LA-2 §14 concept) · "which vendor should I buy from again"
--
-- Restates tenant_vendor_scorecard_report from its only definition (20260913420000) with the
-- concept board's missing pieces and the user's decisions:
--
--   Spend in the period   Net spend is split by the share of records received in the period —
--                         greatest(total - credits, 0) * leads received / records purchased —
--                         the exact formula tenant_campaign_comparison (20260913430000) uses, so
--                         True CPA and the comparison give one answer for one campaign and
--                         period. The old report divided a campaign's LIFETIME spend by the
--                         policies of the period, which made every short range look expensive.
--                         The lifetime figure is still returned as lifetime_net_spend_cents.
--   Persistency           p_persist_days (the page's toggle sends 60): only a policy issued at
--                         least N days ago that was still in force on day N counts — issued, or
--                         lapsed with lapsed_at on or after issued_at + N. Policies issued inside
--                         the last N days cannot be judged yet and are counted separately
--                         (totals.policies_not_yet_measurable) rather than silently dropped.
--   Test batches          tenant_campaigns.is_test_batch (20260925708000). A test batch keeps its
--                         row, is flagged, and is left out of the ranking.
--   Small samples         small_sample when a row has 1 to 4 issued policies: one more sale
--                         moves the figure a long way. Automatic; it is a chip, not an exclusion.
--   Ranking               cost_rank 1..n over rows that have a cost per issued policy and are
--                         not a test batch. Rows are returned ranked first (cheapest policy
--                         first), then rows without a policy, then test batches.
--   Vendor roll-up        vendor_rows: THE per-vendor cost per issued policy. /app/vendors reads
--                         it through lib/vendorScorecard, so there is one definition. A vendor's
--                         figures are over its committed campaigns; a vendor whose every campaign
--                         in scope is a test batch is rolled up over those and flagged.
--   Price per record      cost_per_record_cents and records_purchased on every row.
--   Speed to lead and     Per vendor, read from tenant_vendor_speed_to_lead and
--   consent               tenant_vendor_consent_coverage — the same objects /app/campaigns reads,
--                         so the two pages cannot disagree. Both are all-time and all campaigns:
--                         the views have no period, and a second definition with one would be
--                         the disagreement this avoids.
--   Attempts curve        attempts_to_contact gains share_of_contacts_percent: each attempt
--                         number's share of all contacts, beside its contact rate.
--   Default period        90 days when the caller sends no dates (was 11 months).
--
-- The signature gains p_persist_days, so the old function is dropped and the new one re-granted
-- exactly (service_role only, as before). Callers that send the six old arguments still resolve.
-- ---------------------------------------------------------------------------

drop function if exists public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text);

create or replace function public.tenant_vendor_scorecard_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null,
  p_product_code text default null,
  p_persist_days integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from date := coalesce(p_from_date, current_date - 89);
  v_to date := coalesce(p_to_date, current_date);
  v_persist integer := p_persist_days;
  -- Below this many issued policies a row is a small sample. Returned with the report so the page
  -- says the real threshold instead of a number typed into the UI.
  v_small_sample constant integer := 5;
  v_result jsonb;
begin
  if v_from > v_to then raise exception 'vendor_scorecard_invalid_date_range'; end if;
  if v_persist is not null and (v_persist < 1 or v_persist > 730) then
    raise exception 'vendor_scorecard_invalid_persist_days';
  end if;

  with scoped_campaigns as (
    select c.id as campaign_id, c.vendor_id, c.name as campaign_name, c.product_code,
           c.total_spend_cents, c.records_purchased, c.credits_received_cents,
           c.cost_per_record_cents, coalesce(c.is_test_batch, false) as is_test_batch,
           v.name as vendor_name
      from tenant_campaigns c
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_vendor_id is null or c.vendor_id = p_vendor_id)
       and (p_campaign_id is null or c.id = p_campaign_id)
       and (p_product_code is null or c.product_code = p_product_code
            or exists (select 1 from agent_leads lp where lp.tenant_id = p_tenant_id and lp.campaign_id = c.id and lp.product_line = p_product_code))
  ),
  scoped_leads as (
    select l.id, l.tenant_id, l.campaign_id, l.product_line, l.created_at,
           c.vendor_id, c.campaign_name, c.vendor_name
      from agent_leads l
      join scoped_campaigns c on c.campaign_id = l.campaign_id
     where l.tenant_id = p_tenant_id
       and l.created_at >= v_from::timestamptz
       and l.created_at < (v_to + 1)::timestamptz
       and (p_product_code is null or l.product_line = p_product_code)
  ),
  lead_metrics as (
    select l.*,
      (select count(*)::integer from tenant_call_attempts a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id
          and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz) as attempts,
      (select case when exists (select 1 from tenant_call_attempts a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition is not null
          and is_contact_disposition(a.disposition)
          and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz) then 1 else 0 end) as contacted,
      (select count(*)::integer from tenant_application_cases a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.status <> 'abandoned'
          and a.opened_at >= v_from::timestamptz and a.opened_at < (v_to + 1)::timestamptz
          and a.campaign_id is not distinct from l.campaign_id) as applications,
      (select count(*)::integer from tenant_issued_policies p
        where p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and case
                when v_persist is null then p.status = 'issued'
                else p.issued_at <= now() - make_interval(days => v_persist)
                     and (p.status = 'issued'
                          or (p.status in ('lapsed', 'cancelled') and p.lapsed_at is not null
                              and p.lapsed_at >= p.issued_at + make_interval(days => v_persist)))
              end) as issued_policies,
      (select count(*)::integer from tenant_issued_policies p
        where p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and p.status in ('lapsed', 'cancelled')) as lapsed_policies,
      (select count(*)::integer from tenant_issued_policies p
        where v_persist is not null
          and p.tenant_id = l.tenant_id and p.lead_id = l.id
          and p.issued_at >= v_from::timestamptz and p.issued_at < (v_to + 1)::timestamptz
          and p.campaign_id is not distinct from l.campaign_id
          and p.issued_at > now() - make_interval(days => v_persist)) as policies_not_yet_measurable,
      (select count(*)::integer from tenant_application_cases a
        where a.tenant_id = l.tenant_id and a.lead_id = l.id
          and a.campaign_id is distinct from l.campaign_id) as attribution_warnings,
      (select count(*)::integer from deal_flow d
        where d.tenant_id = l.tenant_id and d.lead_id = l.id
          and d.campaign_id is distinct from l.campaign_id) as deal_attribution_warnings
    from scoped_leads l
  ),
  grouped as (
    select c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name,
      c.product_code, c.total_spend_cents, c.records_purchased, c.credits_received_cents,
      c.cost_per_record_cents, c.is_test_batch,
      (c.total_spend_cents - c.credits_received_cents) as lifetime_net_spend_cents,
      -- tenant_campaign_comparison's allocation, verbatim: spend follows the records received.
      round(greatest(c.total_spend_cents - c.credits_received_cents, 0)::numeric
        * count(l.id) / nullif(c.records_purchased, 0), 2) as net_spend_cents,
      count(l.id)::integer as leads_received,
      coalesce(sum(l.attempts), 0)::integer as attempts,
      coalesce(sum(l.contacted), 0)::integer as contacted_leads,
      coalesce(sum(l.applications), 0)::integer as applications,
      coalesce(sum(l.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(l.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(l.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(l.attribution_warnings + l.deal_attribution_warnings), 0)::integer as attribution_warnings
    from scoped_campaigns c
    left join lead_metrics l on l.campaign_id = c.campaign_id
    group by c.campaign_id, c.vendor_id, c.vendor_name, c.campaign_name, c.product_code,
             c.total_spend_cents, c.records_purchased, c.credits_received_cents,
             c.cost_per_record_cents, c.is_test_batch
  ),
  costed as (
    select g.*,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent,
      (g.issued_policies between 1 and v_small_sample - 1) as small_sample
    from grouped g
  ),
  report_rows as (
    select k.*,
      case when not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null
           then rank() over (
             partition by (not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null)
             order by k.effective_cost_per_issued_policy_cents)
      end::integer as cost_rank
    from costed k
  ),
  totals as (
    select coalesce(round(sum(net_spend_cents), 2), 0) as net_spend_cents,
      coalesce(sum(lifetime_net_spend_cents), 0)::bigint as lifetime_net_spend_cents,
      coalesce(sum(total_spend_cents), 0)::bigint as total_spend_cents,
      coalesce(sum(credits_received_cents), 0)::bigint as credits_received_cents,
      coalesce(sum(records_purchased), 0)::bigint as records_purchased,
      coalesce(sum(leads_received), 0)::integer as leads_received,
      coalesce(sum(attempts), 0)::integer as attempts,
      coalesce(sum(contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(applications), 0)::integer as applications,
      coalesce(sum(issued_policies), 0)::integer as issued_policies,
      coalesce(sum(lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(attribution_warnings), 0)::integer as attribution_warnings,
      count(*)::integer as campaigns,
      count(*) filter (where is_test_batch)::integer as test_batch_campaigns,
      -- Spend that cannot be split because the campaign records no purchased count. It is not in
      -- net_spend_cents, and the page says so rather than showing a smaller number as the whole.
      count(*) filter (where net_spend_cents is null and lifetime_net_spend_cents > 0)::integer as unallocated_spend_campaigns
    from report_rows
  ),
  -- A vendor is judged on its committed buys. Only when every campaign of the vendor in scope is a
  -- test batch is it rolled up over those, and then it is flagged and left out of the ranking.
  vendor_basis as (
    select r.*, bool_and(r.is_test_batch) over (partition by r.vendor_id) as vendor_all_test
      from report_rows r
  ),
  vendor_grouped as (
    select b.vendor_id, max(b.vendor_name) as vendor_name,
      bool_and(b.is_test_batch) as is_test_batch,
      count(*)::integer as campaigns,
      coalesce(sum(b.total_spend_cents), 0)::bigint as total_spend_cents,
      coalesce(sum(b.records_purchased), 0)::bigint as records_purchased,
      coalesce(sum(b.credits_received_cents), 0)::bigint as credits_received_cents,
      coalesce(sum(b.lifetime_net_spend_cents), 0)::bigint as lifetime_net_spend_cents,
      round(sum(b.net_spend_cents), 2) as net_spend_cents,
      coalesce(sum(b.leads_received), 0)::integer as leads_received,
      coalesce(sum(b.attempts), 0)::integer as attempts,
      coalesce(sum(b.contacted_leads), 0)::integer as contacted_leads,
      coalesce(sum(b.applications), 0)::integer as applications,
      coalesce(sum(b.issued_policies), 0)::integer as issued_policies,
      coalesce(sum(b.lapsed_policies), 0)::integer as lapsed_policies,
      coalesce(sum(b.policies_not_yet_measurable), 0)::integer as policies_not_yet_measurable,
      coalesce(sum(b.attribution_warnings), 0)::integer as attribution_warnings
      from vendor_basis b
     where b.is_test_batch = b.vendor_all_test
     group by b.vendor_id
  ),
  vendor_costed as (
    select g.*,
      (select count(*)::integer from report_rows r where r.vendor_id = g.vendor_id and r.is_test_batch) as test_batch_campaigns,
      round(g.total_spend_cents::numeric / nullif(g.records_purchased, 0), 2) as cost_per_record_cents,
      round(g.net_spend_cents / nullif(g.leads_received, 0), 2) as effective_cost_per_lead_cents,
      round(g.net_spend_cents / nullif(g.applications, 0), 2) as effective_cost_per_application_cents,
      round(g.net_spend_cents / nullif(g.issued_policies, 0), 2) as effective_cost_per_issued_policy_cents,
      round(100.0 * g.contacted_leads / nullif(g.leads_received, 0), 2) as contact_rate_percent,
      (g.issued_policies between 1 and v_small_sample - 1) as small_sample,
      s.posted_leads as speed_posted_leads,
      s.dialled_leads as speed_dialled_leads,
      s.median_seconds as speed_median_seconds,
      s.dialled_within_60s_pct as speed_within_60s_pct,
      cc.leads as consent_leads,
      cc.claimed_certificates as consent_claimed_leads,
      cc.claimed_coverage_pct as consent_claimed_pct,
      cc.any_coverage_pct as consent_any_pct
      from vendor_grouped g
      left join tenant_vendor_speed_to_lead s on s.tenant_id = p_tenant_id and s.vendor_id = g.vendor_id
      left join tenant_vendor_consent_coverage cc on cc.tenant_id = p_tenant_id and cc.vendor_id = g.vendor_id
  ),
  vendor_rows as (
    select k.*,
      case when not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null
           then rank() over (
             partition by (not k.is_test_batch and k.effective_cost_per_issued_policy_cents is not null)
             order by k.effective_cost_per_issued_policy_cents)
      end::integer as cost_rank
    from vendor_costed k
  ),
  contact_by_slot as (
    select a.slot, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from tenant_call_attempts a
      join scoped_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
     where a.disposition is not null
       and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz
     group by a.slot
  ),
  attempts_to_contact as (
    select a.attempt_number, count(*)::integer as attempts,
      count(*) filter (where is_contact_disposition(a.disposition))::integer as contacts
      from tenant_call_attempts a
      join scoped_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
     where a.disposition is not null
       and a.attempted_at >= v_from::timestamptz and a.attempted_at < (v_to + 1)::timestamptz
     group by a.attempt_number
  ),
  attempts_shared as (
    select t.*, round(100.0 * t.contacts / nullif(sum(t.contacts) over (), 0), 2) as share_of_contacts_percent
      from attempts_to_contact t
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'generated_at', now(),
    'live', true, 'snapshot', false,
    'persist_days', v_persist,
    'small_sample_below', v_small_sample,
    'spend_basis', 'records_received_share',
    'totals', (select jsonb_build_object(
      'campaigns', campaigns, 'test_batch_campaigns', test_batch_campaigns,
      'unallocated_spend_campaigns', unallocated_spend_campaigns,
      'net_spend_cents', net_spend_cents, 'lifetime_net_spend_cents', lifetime_net_spend_cents,
      'total_spend_cents', total_spend_cents, 'credits_received_cents', credits_received_cents,
      'records_purchased', records_purchased, 'leads_received', leads_received,
      'attempts', attempts, 'contacted_leads', contacted_leads, 'applications', applications,
      'issued_policies', issued_policies, 'lapsed_policies', lapsed_policies,
      'policies_not_yet_measurable', policies_not_yet_measurable,
      'attribution_warnings', attribution_warnings,
      'effective_cost_per_lead_cents', round(net_spend_cents / nullif(leads_received, 0), 2),
      'effective_cost_per_application_cents', round(net_spend_cents / nullif(applications, 0), 2),
      'effective_cost_per_issued_policy_cents', round(net_spend_cents / nullif(issued_policies, 0), 2),
      'contact_rate_percent', round(100.0 * contacted_leads / nullif(leads_received, 0), 2)
    ) from totals),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.is_test_batch, r.cost_rank nulls last, r.net_spend_cents desc nulls last, r.vendor_name, r.campaign_name) from report_rows r), '[]'::jsonb),
    'vendor_rows', coalesce((select jsonb_agg(to_jsonb(v) order by v.is_test_batch, v.cost_rank nulls last, v.net_spend_cents desc nulls last, v.vendor_name) from vendor_rows v), '[]'::jsonb),
    'contact_rate_by_slot', coalesce((select jsonb_agg(jsonb_build_object('slot', slot, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2)) order by slot) from contact_by_slot), '[]'::jsonb),
    'attempts_to_contact', coalesce((select jsonb_agg(jsonb_build_object('attempt_number', attempt_number, 'attempts', attempts, 'contacts', contacts, 'rate_percent', round(100.0 * contacts / nullif(attempts, 0), 2), 'share_of_contacts_percent', share_of_contacts_percent) order by attempt_number) from attempts_shared), '[]'::jsonb),
    'filters', jsonb_build_object('vendor_id', p_vendor_id, 'campaign_id', p_campaign_id, 'product_code', p_product_code)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer) to service_role;

do $$
declare
  v_def text;
  v_report jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text)') is not null then
    raise exception 'the six-argument scorecard report is still there beside the new one';
  end if;
  select pg_get_functiondef('public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)'::regprocedure) into v_def;
  if v_def !~ 'greatest\(c\.total_spend_cents - c\.credits_received_cents, 0\)::numeric' then
    raise exception 'the scorecard does not split spend the way tenant_campaign_comparison does';
  end if;
  if has_function_privilege('tenant_app', 'public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.tenant_vendor_scorecard_report(uuid, date, date, uuid, uuid, text, integer)', 'execute') then
    raise exception 'the scorecard report is callable outside the service role';
  end if;

  -- Runs, and an unknown tenant gets an empty, well-formed report.
  v_report := public.tenant_vendor_scorecard_report(gen_random_uuid(), null, null, null, null, null, 60);
  if jsonb_typeof(v_report -> 'vendor_rows') <> 'array' or jsonb_array_length(v_report -> 'rows') <> 0
     or (v_report ->> 'persist_days')::integer <> 60 or (v_report ->> 'from')::date <> current_date - 89 then
    raise exception 'the scorecard report did not return its new shape: %', v_report;
  end if;
  raise notice '20260925708200: vendor scorecard ranks by cost per issued policy, spend split by records received';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708200', 'vendor_scorecard_ranks_vendors_by_cost_per_policy') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [14/18] 20260925708300_mark_policy_issued_and_lapsed.sql ──────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Scorecard · the first writer of tenant_issued_policies
--
-- 20260922190000 measured it: nothing in the product writes tenant_issued_policies, so the
-- scorecard's Issued column and True CPA were "correct, computable, and permanently null". User
-- decision: a manual "Mark issued" on a deal (carrier, policy number, issue date), and later
-- "Mark lapsed" (lapse date), owner and producer only.
--
-- Both go through the table's existing BEFORE trigger, enforce_issued_policy_attribution
-- (20260913420000), which fills campaign and vendor from the deal, then the lead, and refuses a
-- policy whose attribution disagrees with its deal or application. These functions only add what
-- the trigger cannot know: which deal, that it belongs to the tenant, that it has no live policy
-- already, and that the dates are possible.
--
-- The deal-flow report (20260924320000) already reads the latest issued policy per lead, so a
-- "Policy issued" step appears on the deal's timeline the moment one is marked.
-- ---------------------------------------------------------------------------

create or replace function public.mark_deal_policy_issued(
  p_tenant_id uuid,
  p_deal_id uuid,
  p_carrier text,
  p_policy_number text,
  p_issued_on date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deal record;
  v_policy tenant_issued_policies%rowtype;
begin
  if p_carrier is null or char_length(btrim(p_carrier)) not between 1 and 160 then
    raise exception 'ISSUED_POLICY_CARRIER_REQUIRED';
  end if;
  if p_policy_number is null or char_length(btrim(p_policy_number)) not between 1 and 120 then
    raise exception 'ISSUED_POLICY_NUMBER_REQUIRED';
  end if;
  if p_issued_on is null or p_issued_on > current_date then
    raise exception 'ISSUED_POLICY_DATE_INVALID';
  end if;

  select d.id, d.tenant_id, d.lead_id, d.product_line into v_deal
    from deal_flow d
   where d.id = p_deal_id and d.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'ISSUED_POLICY_DEAL_NOT_FOUND'; end if;

  if exists (select 1 from tenant_issued_policies p
              where p.tenant_id = p_tenant_id and p.deal_id = p_deal_id and p.status = 'issued') then
    raise exception 'ISSUED_POLICY_ALREADY_ISSUED';
  end if;

  insert into tenant_issued_policies (tenant_id, lead_id, deal_id, product_line, carrier, policy_number, status, issued_at)
  values (p_tenant_id, v_deal.lead_id, v_deal.id, v_deal.product_line, btrim(p_carrier), btrim(p_policy_number), 'issued', p_issued_on::timestamptz)
  returning * into v_policy;

  return to_jsonb(v_policy);
end;
$function$;

create or replace function public.mark_issued_policy_lapsed(
  p_tenant_id uuid,
  p_policy_id uuid,
  p_lapsed_on date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy tenant_issued_policies%rowtype;
begin
  select * into v_policy
    from tenant_issued_policies p
   where p.id = p_policy_id and p.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'ISSUED_POLICY_NOT_FOUND'; end if;
  if v_policy.status <> 'issued' then raise exception 'ISSUED_POLICY_NOT_IN_FORCE'; end if;
  if p_lapsed_on is null or p_lapsed_on > current_date then raise exception 'ISSUED_POLICY_DATE_INVALID'; end if;
  if p_lapsed_on::timestamptz < v_policy.issued_at then raise exception 'ISSUED_POLICY_LAPSE_BEFORE_ISSUE'; end if;

  update tenant_issued_policies
     set status = 'lapsed', lapsed_at = p_lapsed_on::timestamptz, updated_at = now()
   where id = v_policy.id
  returning * into v_policy;

  return to_jsonb(v_policy);
end;
$function$;

revoke all on function public.mark_deal_policy_issued(uuid, uuid, text, text, date) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_issued_policy_lapsed(uuid, uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.mark_deal_policy_issued(uuid, uuid, text, text, date) to service_role;
grant execute on function public.mark_issued_policy_lapsed(uuid, uuid, date) to service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.mark_deal_policy_issued(uuid, uuid, text, text, date)') is null
     or to_regprocedure('public.mark_issued_policy_lapsed(uuid, uuid, date)') is null then
    raise exception 'the issued-policy writers did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.mark_deal_policy_issued(uuid, uuid, text, text, date)', 'execute')
     or has_function_privilege('tenant_app', 'public.mark_issued_policy_lapsed(uuid, uuid, date)', 'execute') then
    raise exception 'the tenant plane can write issued policies directly';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.tenant_issued_policies'::regclass
                    and tgname = 'tenant_issued_policies_attribution' and not tgisinternal) then
    raise exception 'the attribution trigger these writers rely on is missing';
  end if;

  -- A deal that is not the tenant's is refused before anything is written.
  begin
    perform public.mark_deal_policy_issued(gen_random_uuid(), gen_random_uuid(), 'Carrier', 'P-1', current_date);
    raise exception 'mark_deal_policy_issued accepted a deal that does not exist';
  exception when others then
    if sqlerrm <> 'ISSUED_POLICY_DEAL_NOT_FOUND' then raise; end if;
  end;
  raise notice '20260925708300: Mark issued and Mark lapsed write tenant_issued_policies through the attribution trigger';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708300', 'mark_policy_issued_and_lapsed') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [15/18] 20260925708500_callbacks_close_on_the_call.sql ────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Callbacks · a callback counts when the call comes back (LA-1 §6.3)
--
-- User decisions (2026-09-25, Callbacks concept audit):
--
--   KEPT     A contact outcome on a dial of that lead, placed from 15 minutes before the callback
--            was due to the end of the customer's day (in the customer's own timezone), closes the
--            callback automatically. A no-answer (any non-contact outcome) keeps it open.
--   MANUAL   "Mark done" stays as an override, is recorded as manual, and no longer reopens the
--            work item — where the lead goes next is the call's outcome, not the button.
--   REBOOK   A new callback booked on a lead replaces the one still open on it (history
--            'replaced'), so a missed callback leaves Overdue when it is rebooked, and a rebook on
--            the same work item no longer collides with tenant_callbacks_active_work_item_idx.
--
-- Objects:
--   tenant_callbacks          + completed_via ('manual' | 'call'), kept_attempt_id, missed_at,
--                               reopened_at, reopened_from, released_at, in_app_reminded_at
--   callback_history          + via; actor_user_id nullable (the system closes and reopens
--                               callbacks too); actions + 'reopened', 'released', 'replaced'
--   tenant_call_attempts_keeps_callback  AFTER INSERT OR UPDATE OF disposition on
--                               tenant_call_attempts (distinct from Activity's
--                               tenant_call_attempt_record_activity)
--   tenant_callbacks_before_update_callbacks  when a reopened callback stops being due, its work
--                               item goes back to how the outcome left it if nobody has dialled it;
--                               a moved time re-arms the in-app reminder
--   tenant_callbacks_replace_open_one  BEFORE INSERT on tenant_callbacks
--   complete_callback         restated from 20260913160000 (its latest definition)
--   callback_work_item_holder(tenant, work_item)   the booked agent while a due callback holds the
--                               work item — for the Dialer's serve_next_lead (not edited here)
--   callback_tier_due(tenant, work_item, now)      whether the work item is a due callback nobody
--                               has dialled since it came due — likewise offered to the Dialer
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.tenant_callbacks') is null then
    raise exception 'tenant_callbacks does not exist; apply 20260913160000 before this file';
  end if;
  if to_regprocedure('public.is_contact_disposition(text)') is null then
    raise exception 'is_contact_disposition does not exist; apply 20260913390000 before this file';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_call_attempts' and column_name = 'dial_clicked_at') then
    raise exception 'tenant_call_attempts.dial_clicked_at does not exist; apply 20260913350000 before this file';
  end if;
end $$;

-- ── columns ────────────────────────────────────────────────────────────────
alter table public.tenant_callbacks
  add column if not exists completed_via text,
  add column if not exists kept_attempt_id uuid references public.tenant_call_attempts(id) on delete set null,
  add column if not exists missed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_from jsonb,
  add column if not exists released_at timestamptz,
  add column if not exists in_app_reminded_at timestamptz;

alter table public.tenant_callbacks drop constraint if exists tenant_callbacks_completed_via_check;
alter table public.tenant_callbacks add constraint tenant_callbacks_completed_via_check
  check (completed_via is null or completed_via in ('manual', 'call'));

-- completed_via  how a completed callback was closed: 'call' (a contact outcome on a dial of the
--                lead inside the kept window) or 'manual' (Mark done).
-- missed_at      when the customer's calling window closed on the due day with no kept call. Never
--                cleared, so a missed callback that is later rebooked still counts as missed once.
-- reopened_from  the work item as the outcome left it, kept while a due callback holds the work
--                item for its agent, so it can be put back if nobody dials it.

-- The kept trigger and the rebook trigger both look callbacks up by lead.
create index if not exists tenant_callbacks_open_lead_idx
  on public.tenant_callbacks (tenant_id, lead_id)
  where status in ('scheduled', 'due', 'missed');
-- The due job scans every tenant by time.
create index if not exists tenant_callbacks_open_time_idx
  on public.tenant_callbacks (scheduled_at_utc)
  where status in ('scheduled', 'due');

alter table public.callback_history alter column actor_user_id drop not null;
alter table public.callback_history add column if not exists via text;
alter table public.callback_history drop constraint if exists callback_history_via_check;
alter table public.callback_history add constraint callback_history_via_check
  check (via is null or via in ('manual', 'call', 'system'));
alter table public.callback_history drop constraint if exists callback_history_action_check;
alter table public.callback_history add constraint callback_history_action_check
  check (action in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'missed', 'reopened', 'released', 'replaced'));

-- ── the call closes the callback ───────────────────────────────────────────
create or replace function public.tenant_call_attempts_keeps_callback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_at timestamptz;
  r record;
begin
  if new.disposition is null or not public.is_contact_disposition(new.disposition) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.disposition is not null then
    return new;
  end if;
  -- When the call was placed: the dial press when there was one, else when the attempt began.
  v_at := coalesce(new.dial_clicked_at, new.attempted_at);

  for r in
    with o as (
      select cb.id, cb.status as old_status
        from public.tenant_callbacks cb
       where cb.tenant_id = new.tenant_id
         and cb.lead_id = new.lead_id
         and cb.status in ('scheduled', 'due', 'missed')
         and v_at >= cb.scheduled_at_utc - interval '15 minutes'
         and v_at < (((cb.scheduled_at_utc at time zone cb.customer_timezone)::date + 1)::timestamp
                     at time zone cb.customer_timezone)
       for update
    )
    update public.tenant_callbacks cb
       set status = 'completed', completed_at = now(), completed_via = 'call',
           kept_attempt_id = new.id, updated_at = now()
      from o
     where cb.id = o.id
    returning cb.id, cb.lead_id, cb.work_item_id, cb.scheduled_at_utc, o.old_status
  loop
    insert into public.callback_history
      (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
    values
      (new.tenant_id, r.id, r.lead_id, new.agent_id, 'completed', r.scheduled_at_utc, r.old_status, 'completed',
       'Kept: the customer was reached on this call', 'call');
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ((case when new.agent_id is null then 'system' else 'tenant' end)::public.audit_actor_type,
            new.agent_id, 'tenant.callback_completed', 'callback', r.id::text,
            jsonb_build_object('tenantId', new.tenant_id, 'leadId', r.lead_id, 'workItemId', r.work_item_id,
                               'via', 'call', 'attemptId', new.id, 'disposition', new.disposition));
  end loop;
  return new;
end;
$function$;

revoke all on function public.tenant_call_attempts_keeps_callback() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_call_attempts_keeps_callback on public.tenant_call_attempts;
create trigger tenant_call_attempts_keeps_callback
after insert or update of disposition on public.tenant_call_attempts
for each row execute function public.tenant_call_attempts_keeps_callback();

-- ── a reopened callback that stops being due gives its work item back ─────
--
-- run_callback_due (20260925708700) hands a dispositioned work item back to the booked agent when
-- the callback comes due, and keeps what the outcome had written in reopened_from. When the
-- callback then stops being due WITHOUT a kept call — Mark done, cancelled, rebooked for later,
-- missed — and nobody has dialled the lead since, the work item goes back exactly as the outcome
-- left it. A dial in between wrote its own outcome to the work item (disposition not null), and
-- that outcome stands. A lead the reclaim already returned to the cadence (lead_state no longer
-- 'working') is not touched either.
create or replace function public.tenant_callbacks_before_update_callbacks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_owner uuid;
begin
  if new.scheduled_at_utc is distinct from old.scheduled_at_utc then
    new.in_app_reminded_at := null;
  end if;

  if old.reopened_at is null or new.status = 'due' then
    return new;
  end if;

  if coalesce(new.completed_via, '') <> 'call' and old.reopened_from is not null then
    update public.lead_queue q
       set status = coalesce(old.reopened_from->>'status', 'completed'),
           disposition = old.reopened_from->>'disposition',
           disposition_at = nullif(old.reopened_from->>'disposition_at', '')::timestamptz,
           disposition_by = nullif(old.reopened_from->>'disposition_by', '')::uuid,
           owner_user_id = nullif(old.reopened_from->>'owner_user_id', '')::uuid,
           claimed_by = nullif(old.reopened_from->>'claimed_by', '')::uuid,
           claimed_at = nullif(old.reopened_from->>'claimed_at', '')::timestamptz,
           owner_role = old.reopened_from->>'owner_role',
           locked_until = null,
           updated_at = now()
     where q.id = old.work_item_id
       and q.tenant_id = old.tenant_id
       and q.status in ('claimed', 'unclaimed')
       and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and exists (select 1 from public.agent_leads l
                    where l.id = q.lead_id and l.tenant_id = q.tenant_id and l.lead_state = 'working')
    returning q.owner_user_id into v_owner;
    -- The capacity trigger refreshes only the NEW owner; the agent who held it is refreshed here.
    if found and to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
      perform public.refresh_agent_capacity_for_user(old.tenant_id, old.assigned_to);
    end if;
  end if;

  new.reopened_at := null;
  new.reopened_from := null;
  new.released_at := null;
  return new;
end;
$function$;

revoke all on function public.tenant_callbacks_before_update_callbacks() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_callbacks_before_update_callbacks on public.tenant_callbacks;
create trigger tenant_callbacks_before_update_callbacks
before update on public.tenant_callbacks
for each row execute function public.tenant_callbacks_before_update_callbacks();

-- ── one open callback per lead: a new booking replaces the old one ────────
create or replace function public.tenant_callbacks_replace_open_one()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  r record;
begin
  if new.status not in ('scheduled', 'due') then
    return new;
  end if;
  for r in
    with o as (
      select cb.id, cb.status as old_status
        from public.tenant_callbacks cb
       where cb.tenant_id = new.tenant_id
         and cb.lead_id = new.lead_id
         and cb.id <> new.id
         and cb.status in ('scheduled', 'due', 'missed')
       for update
    )
    update public.tenant_callbacks cb
       set status = 'cancelled', updated_at = now()
      from o
     where cb.id = o.id
    returning cb.id, cb.lead_id, cb.work_item_id, cb.scheduled_at_utc, o.old_status
  loop
    insert into public.callback_history
      (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note, via)
    values
      (new.tenant_id, r.id, r.lead_id, new.created_by, 'replaced', r.scheduled_at_utc, new.scheduled_at_utc, r.old_status, 'cancelled',
       'Replaced by a new callback on the same lead', 'system');
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', new.created_by, 'tenant.callback_replaced', 'callback', r.id::text,
            jsonb_build_object('tenantId', new.tenant_id, 'leadId', r.lead_id, 'workItemId', r.work_item_id,
                               'replacedBy', new.id, 'oldStatus', r.old_status));
  end loop;
  return new;
end;
$function$;

revoke all on function public.tenant_callbacks_replace_open_one() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_callbacks_replace_open_one on public.tenant_callbacks;
create trigger tenant_callbacks_replace_open_one
before insert on public.tenant_callbacks
for each row execute function public.tenant_callbacks_replace_open_one();

-- ── Mark done: manual, and it no longer moves the work item ───────────────
-- Restated from 20260913160000 (its latest definition; 20260913360000 patched only
-- reschedule_callback and complete_disposition_with_callback). Changes: completed_via = 'manual',
-- the real old status in history, and NO lead_queue write — the old body reopened a dispositioned
-- work item to 'unclaimed', which put a 'working' lead in the pool on no tier. A work item that
-- run_callback_due had handed back is returned by tenant_callbacks_before_update_callbacks.
create or replace function public.complete_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks; v_old_status text;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  if c.status = 'cancelled' then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  v_old_status := c.status;
  update public.tenant_callbacks set status = 'completed', completed_at = now(), completed_via = 'manual', updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'completed', c.scheduled_at_utc, v_old_status, c.status, c.note, 'manual');
  update public.agent_leads set callback_subtype = null, updated_at = now() where id = c.lead_id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_completed', 'callback', c.id::text, jsonb_build_object('tenantId', p_tenant_id, 'leadId', c.lead_id, 'workItemId', c.work_item_id, 'via', 'manual', 'oldStatus', v_old_status));
  return jsonb_build_object('id', c.id, 'status', c.status, 'work_item_id', c.work_item_id, 'via', 'manual', 'duplicate', false);
end;
$$;

revoke all on function public.complete_callback(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_callback(uuid, uuid, uuid) to service_role;

-- ── for the Dialer's serving query (offered, not wired in here) ───────────
-- Who holds a work item while a due callback has handed it back to its agent. Null otherwise, and
-- null once the callback was released to the shared pool.
create or replace function public.callback_work_item_holder(p_tenant_id uuid, p_work_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select cb.assigned_to
    from public.tenant_callbacks cb
   where cb.tenant_id = p_tenant_id
     and cb.work_item_id = p_work_item_id
     and cb.status = 'due'
     and cb.reopened_at is not null
     and cb.released_at is null
   order by cb.scheduled_at_utc desc
   limit 1;
$function$;

revoke all on function public.callback_work_item_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.callback_work_item_holder(uuid, uuid) to tenant_app, service_role;

-- Whether a work item is a callback that is due and has not been dialled since it came due (from
-- 15 minutes before). A no-answer keeps the callback open but must not make it tier 2 again on the
-- very next serve: after a dial, the call's own outcome decides when the lead is next served.
create or replace function public.callback_tier_due(p_tenant_id uuid, p_work_item_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select exists (
    select 1
      from public.tenant_callbacks cb
     where cb.tenant_id = p_tenant_id
       and cb.work_item_id = p_work_item_id
       and cb.status in ('scheduled', 'due')
       and cb.scheduled_at_utc <= p_now
       and not exists (
         select 1 from public.tenant_call_attempts ca
          where ca.tenant_id = p_tenant_id
            and ca.lead_id = cb.lead_id
            and ca.attempted_at >= cb.scheduled_at_utc - interval '15 minutes'
       )
  );
$function$;

revoke all on function public.callback_tier_due(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.callback_tier_due(uuid, uuid, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_callbacks'
         and column_name in ('completed_via', 'kept_attempt_id', 'missed_at', 'reopened_at', 'reopened_from', 'released_at', 'in_app_reminded_at')) <> 7 then
    raise exception 'tenant_callbacks is missing a callback-lifecycle column';
  end if;

  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_call_attempts' and t.tgname = 'tenant_call_attempts_keeps_callback' and not t.tgisinternal) then
    raise exception 'the call-closes-callback trigger is not on tenant_call_attempts';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_callbacks' and t.tgname = 'tenant_callbacks_replace_open_one' and not t.tgisinternal) then
    raise exception 'the rebook trigger is not on tenant_callbacks';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_callbacks' and t.tgname = 'tenant_callbacks_before_update_callbacks' and not t.tgisinternal) then
    raise exception 'the work-item return trigger is not on tenant_callbacks';
  end if;

  select pg_get_functiondef('public.complete_callback(uuid, uuid, uuid)'::regprocedure) into v_src;
  if strpos(v_src, 'update public.lead_queue') > 0 then
    raise exception 'Mark done still moves the work item';
  end if;
  if strpos(v_src, 'completed_via = ''manual''') = 0 then
    raise exception 'Mark done is not recorded as manual';
  end if;

  -- The kept window: 15 minutes early is kept, 16 is not; the customer's day bounds the end.
  if not ((timestamptz '2026-09-24 17:45:00+00' >= timestamptz '2026-09-24 18:00:00+00' - interval '15 minutes')
          and not (timestamptz '2026-09-24 17:44:00+00' >= timestamptz '2026-09-24 18:00:00+00' - interval '15 minutes')) then
    raise exception 'kept window arithmetic is wrong';
  end if;
  if (((timestamptz '2026-09-24 18:00:00+00' at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles')
     <> timestamptz '2026-09-25 07:00:00+00' then
    raise exception 'end of the customer''s day is computed in the wrong timezone';
  end if;

  raise notice '20260925708500: a contact on the call keeps the callback; Mark done is manual and leaves the work item alone';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708500', 'callbacks_close_on_the_call') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [16/18] 20260925708600_callbacks_nearest_legal_time.sql ───────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Callbacks · the nearest legal time (LA-1 §6.3)
--
-- "Marcus Pell's callback could not be booked for 7:30 AM. Oregon opens at 8:00 AM local. The
-- nearest legal time is 8:00 AM his time." A refusal that names the next time the customer MAY be
-- called, so the agent can offer it. User decision: a "Use that" suggestion only — nothing here
-- books anything.
--
--   next_callable_instant(tenant, lead, from, until)  the first instant at or after `from` at which
--       tenant_can_dial_now (20260924230100 — federal, state, holidays, Sundays, agency, campaign;
--       the function serve_next_lead and assert_callback_in_window enforce) allows this lead to be
--       called. Searched on the customer's quarter hours, then refined to five minutes, for at most
--       14 days. Null when the lead has no state, the rules feed is stale (every answer would be
--       "no"), or nothing is legal before `until`.
--
-- Callers pass a `from` a few minutes in the future; the function does not add its own buffer.
-- run_callback_due (20260925708700) also asks it whether the customer's window will open again
-- before their day ends.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.tenant_can_dial_now(uuid, text, uuid, timestamp with time zone)') is null then
    raise exception 'tenant_can_dial_now does not exist; apply 20260924230100 before this file';
  end if;
end $$;

create or replace function public.next_callable_instant(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_from timestamptz,
  p_until timestamptz default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text;
  v_campaign uuid;
  v_zone text;
  v_until timestamptz;
  v_local timestamp;
  v_at timestamptz;
  v_fine timestamptz;
  k integer;
begin
  if p_from is null then return null; end if;

  select upper(btrim(l.values->>'state')), l.campaign_id
    into v_state, v_campaign
    from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if v_state is null or v_state !~ '^[A-Z]{2}$' then return null; end if;

  -- A stale feed refuses every instant; searching fourteen days of refusals would say nothing true.
  if to_regprocedure('public.calling_window_rules_stale(timestamp with time zone)') is not null
     and public.calling_window_rules_stale(now()) then
    return null;
  end if;

  select timezone into v_zone from public.state_timezones where state = v_state;
  if v_zone is null then return null; end if;

  v_until := least(coalesce(p_until, p_from + interval '14 days'), p_from + interval '14 days');

  if public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_from) then
    return p_from;
  end if;

  -- The next quarter hour on the customer's clock.
  v_local := p_from at time zone v_zone;
  v_local := date_trunc('hour', v_local)
             + (floor(extract(minute from v_local) / 15)::integer + 1) * interval '15 minutes';

  loop
    v_at := v_local at time zone v_zone;
    exit when v_at > v_until;
    if public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_at) then
      -- A window may open on a minute (Settings › Calling windows keeps minutes): look back ten
      -- and five minutes for an earlier legal instant that is still after `from`.
      for k in reverse 2..1 loop
        v_fine := v_at - make_interval(mins => 5 * k);
        if v_fine > p_from and public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_fine) then
          return v_fine;
        end if;
      end loop;
      return v_at;
    end if;
    v_local := v_local + interval '15 minutes';
  end loop;

  return null;
end;
$function$;

revoke all on function public.next_callable_instant(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.next_callable_instant(uuid, uuid, timestamptz, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_zone text;
  v_three_am timestamptz;
  v_next timestamptz;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708600: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.next_callable_instant(uuid, uuid, timestamp with time zone, timestamp with time zone)') is null then
    raise exception 'next_callable_instant was not created';
  end if;

  -- 3am tomorrow for a real lead with a state: the answer must be later, legal, and on the same
  -- customer-local day or after.
  select l.tenant_id, l.id, z.timezone into v_tenant, v_lead, v_zone
    from public.agent_leads l
    join public.state_timezones z on z.state = upper(btrim(l.values->>'state'))
   where l.values->>'state' ~ '^[A-Za-z]{2}$'
   limit 1;
  if v_lead is null then
    raise notice '20260925708600: no lead with a state; behaviour check skipped';
    return;
  end if;
  v_three_am := ((now() at time zone v_zone)::date + 1 + time '03:00')::timestamp at time zone v_zone;
  v_next := public.next_callable_instant(v_tenant, v_lead, v_three_am, null);
  if v_next is null then
    raise notice '20260925708600: nothing legal within 14 days for the sample lead (stale rules feed?); check skipped';
  elsif v_next <= v_three_am then
    raise exception 'next_callable_instant returned % for a refused 3am (%), not a later time', v_next, v_three_am;
  elsif not public.tenant_can_dial_now(v_tenant, (select upper(btrim(values->>'state')) from public.agent_leads where id = v_lead), (select campaign_id from public.agent_leads where id = v_lead), v_next) then
    raise exception 'next_callable_instant returned % which tenant_can_dial_now refuses', v_next;
  end if;
  raise notice '20260925708600: the nearest legal time after a refused one is found, never booked';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708600', 'callbacks_nearest_legal_time') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [17/18] 20260925708700_callbacks_come_due_on_a_schedule.sql ───────────────────
begin;

-- ---------------------------------------------------------------------------
-- Callbacks · due, back with the agent, released, missed, reminded — on pg_cron (LA-1 §6.3)
--
-- Measured live 2026-09-25: two open callbacks, both on lead_queue items already 'completed', so
-- neither was ever served — tier 2 of serve_next_lead only reads unclaimed or agent-claimed items,
-- and every outcome that books a callback completes its work item. Nothing ran when a callback
-- came due, and the reminder job (scripts/send-callback-reminders.mjs) was never scheduled.
--
-- User decisions (2026-09-25):
--   DUE       At the due time the work item goes back to the BOOKED AGENT: claimed by them,
--             unlocked, disposition cleared. What the outcome had written is kept in
--             tenant_callbacks.reopened_from and restored if the callback stops being due with
--             nobody having dialled it (20260925708500's trigger).
--   RELEASE   30 minutes overdue and still undialled, the work item goes to the shared pool —
--             OUTBOUND ONLY. Design 3 (inbound): list_transfer_inbox, the floor queue and
--             run_unclaimed_sla treat ANY unclaimed lead_queue row with a partner as a live
--             transfer, so releasing one would re-show it in the Transfer inbox, start the SLA
--             ladder and send the partner a false "nobody claimed" card. An inbound callback stays
--             with its booked agent and shows as overdue; it is never set to unclaimed.
--   MISSED    When the customer's calling window closes on the due day with no kept call. It
--             stays in Overdue (Callbacks page) until rebooked or cancelled; missed_at is kept.
--   REMINDER  pg_cron writes the in-app reminder (agent_notifications, the same source_key the
--             app's email job upserts, so the two never duplicate). Email stays with the app.
--
--   run_callback_due(now, limit)            jsonb {missed, due, reopened, released}
--   run_callback_in_app_reminders(now, limit)  integer, reminders written
--   pg_cron: callback-due, callback-in-app-reminders (every minute), callback-jobs-log-cleanup
-- ---------------------------------------------------------------------------

do $$
begin
  -- Only a role that can apply this file needs its prerequisites; the parse check runs without them.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then return; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_callbacks' and column_name = 'reopened_from') then
    raise exception 'tenant_callbacks.reopened_from does not exist; apply 20260925708500 before this file';
  end if;
  if to_regprocedure('public.next_callable_instant(uuid, uuid, timestamp with time zone, timestamp with time zone)') is null then
    raise exception 'next_callable_instant does not exist; apply 20260925708600 before this file';
  end if;
end $$;

create or replace function public.run_callback_due(p_now timestamptz default now(), p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_stale boolean := false;
  v_missed integer := 0;
  v_due integer := 0;
  v_reopened integer := 0;
  v_released integer := 0;
  v_day_end timestamptz;
  v_next timestamptz;
  c record;
  q public.lead_queue;
begin
  -- A stale rules feed makes tenant_can_dial_now refuse every instant. That must not read as
  -- "the window has closed": while it is stale only the end of the customer's day makes a miss.
  if to_regprocedure('public.calling_window_rules_stale(timestamp with time zone)') is not null then
    v_stale := public.calling_window_rules_stale(now());
  end if;

  -- ── 1 · missed: the customer's window has closed on the due day ────────
  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.status, cb.scheduled_at_utc, cb.customer_timezone,
           l.values->>'state' as lead_state_code, l.campaign_id as lead_campaign
      from public.tenant_callbacks cb
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
     where cb.status in ('scheduled', 'due')
       and cb.scheduled_at_utc < p_now
     order by cb.scheduled_at_utc
     limit v_limit
     for update of cb skip locked
  loop
    v_day_end := (((c.scheduled_at_utc at time zone c.customer_timezone)::date + 1)::timestamp
                  at time zone c.customer_timezone);
    v_next := null;
    if p_now < v_day_end and not v_stale
       and not public.tenant_can_dial_now(c.tenant_id, c.lead_state_code, c.lead_campaign, p_now) then
      v_next := public.next_callable_instant(c.tenant_id, c.lead_id, p_now, v_day_end);
    end if;
    if p_now >= v_day_end
       or (not v_stale
           and not public.tenant_can_dial_now(c.tenant_id, c.lead_state_code, c.lead_campaign, p_now)
           and (v_next is null or v_next >= v_day_end)) then
      update public.tenant_callbacks
         set status = 'missed', missed_at = coalesce(missed_at, p_now), updated_at = p_now
       where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'missed', c.scheduled_at_utc, c.status, 'missed',
         'The customer''s calling window closed on the due day with no kept call', 'system');
      insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
      values ('system', null, 'tenant.callback_missed', 'callback', c.id::text,
              jsonb_build_object('tenantId', c.tenant_id, 'leadId', c.lead_id, 'scheduledAtUtc', c.scheduled_at_utc));
      v_missed := v_missed + 1;
    end if;
  end loop;

  -- ── 2 · due: back with the agent who booked it ─────────────────────────
  for c in
    select cb.*
      from public.tenant_callbacks cb
     where cb.status = 'scheduled'
       and cb.scheduled_at_utc <= p_now
     order by cb.scheduled_at_utc
     limit v_limit
     for update skip locked
  loop
    select * into q from public.lead_queue
     where id = c.work_item_id and tenant_id = c.tenant_id
     for update;
    if found
       and q.status in ('completed', 'dropped')
       and q.disposition is not null
       and exists (select 1 from public.agent_leads l
                    where l.id = c.lead_id and l.tenant_id = c.tenant_id and l.lead_state = 'working')
       -- The lead is not already being worked through another work item.
       and not exists (select 1 from public.lead_queue o
                        where o.tenant_id = c.tenant_id and o.lead_id = c.lead_id and o.id <> q.id
                          and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
       -- The agent can still take work here.
       and exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                    where tu.tenant_id = c.tenant_id and tu.user_id = c.assigned_to
                      and tu.accepted_at is not null and u.status::text = 'active')
    then
      update public.lead_queue
         set status = 'claimed', owner_user_id = c.assigned_to, claimed_by = c.assigned_to, claimed_at = p_now,
             locked_until = null, disposition = null, disposition_at = null, disposition_by = null,
             updated_at = p_now
       where id = q.id;
      update public.tenant_callbacks
         set status = 'due', reopened_at = p_now, released_at = null, updated_at = p_now,
             reopened_from = jsonb_build_object(
               'status', q.status, 'disposition', q.disposition, 'disposition_at', q.disposition_at,
               'disposition_by', q.disposition_by, 'owner_user_id', q.owner_user_id, 'claimed_by', q.claimed_by,
               'claimed_at', q.claimed_at, 'owner_role', q.owner_role)
       where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'reopened', c.scheduled_at_utc, 'scheduled', 'due',
         'Due: the lead is back with the agent who booked it', 'system');
      v_reopened := v_reopened + 1;
    else
      update public.tenant_callbacks set status = 'due', updated_at = p_now where id = c.id;
    end if;
    v_due := v_due + 1;
  end loop;

  -- ── 3 · released: 30 minutes overdue, undialled, OUTBOUND ONLY ─────────
  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.work_item_id, cb.assigned_to, cb.scheduled_at_utc
      from public.tenant_callbacks cb
      join public.lead_queue q on q.id = cb.work_item_id and q.tenant_id = cb.tenant_id
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
     where cb.status = 'due'
       and cb.reopened_at is not null
       and cb.released_at is null
       and cb.scheduled_at_utc <= p_now - interval '30 minutes'
       and q.status = 'claimed'
       and q.owner_user_id = cb.assigned_to
       and q.disposition is null
       and (q.locked_until is null or q.locked_until < p_now)
       -- Inbound partner leads never go to unclaimed (Design 3): the Transfer inbox, the floor and
       -- the unclaimed-SLA ladder would take them for a live transfer.
       and q.partner_id is null
       and l.partner_id is null
     order by cb.scheduled_at_utc
     limit v_limit
     for update of cb, q skip locked
  loop
    update public.lead_queue
       set status = 'unclaimed', owner_user_id = null, claimed_by = null, claimed_at = null,
           locked_until = null, updated_at = p_now
     where id = c.work_item_id and status = 'claimed' and partner_id is null;
    if found then
      update public.tenant_callbacks set released_at = p_now, updated_at = p_now where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'released', c.scheduled_at_utc, 'due', 'due',
         'Thirty minutes overdue: released to the shared queue', 'system');
      if to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
        perform public.refresh_agent_capacity_for_user(c.tenant_id, c.assigned_to);
      end if;
      v_released := v_released + 1;
    end if;
  end loop;

  return jsonb_build_object('missed', v_missed, 'due', v_due, 'reopened', v_reopened, 'released', v_released);
end;
$function$;

revoke all on function public.run_callback_due(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_callback_due(timestamptz, integer) to service_role;

-- ── in-app reminders ───────────────────────────────────────────────────────
-- The lead time is the platform setting callbacks.reminder_lead_minutes (default 30, 5–1440), the
-- same one lib/callbacks/reminders.ts reads. Title, body, link and source_key match what that job
-- writes, so whichever runs first, the agent sees one reminder.
create or replace function public.run_callback_in_app_reminders(p_now timestamptz default now(), p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_minutes integer := 30;
  v_raw text;
  v_count integer := 0;
  v_name text;
  c record;
begin
  if to_regclass('public.settings') is not null then
    select s.value #>> '{}' into v_raw from public.settings s where s.key = 'callbacks.reminder_lead_minutes';
    if v_raw ~ '^\s*\d+(\.\d+)?\s*$' then
      v_minutes := greatest(5, least(1440, round(v_raw::numeric)::integer));
    end if;
  end if;

  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.assigned_to, cb.scheduled_at_utc, cb.customer_timezone, l.values
      from public.tenant_callbacks cb
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
      join public.users u on u.id = cb.assigned_to and u.status::text = 'active'
     where cb.status = 'scheduled'
       and cb.in_app_reminded_at is null
       and cb.scheduled_at_utc > p_now
       and cb.scheduled_at_utc <= p_now + make_interval(mins => v_minutes)
     order by cb.scheduled_at_utc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update of cb skip locked
  loop
    v_name := coalesce(nullif(btrim(c.values->>'full_name'), ''),
                       nullif(btrim(c.values->>'name'), ''),
                       nullif(btrim(concat_ws(' ', c.values->>'first_name', c.values->>'last_name')), ''),
                       'Customer');
    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    values (c.tenant_id, c.assigned_to, 'callback_reminder',
            left('Callback reminder: ' || v_name, 160),
            'Callback at ' || to_char(c.scheduled_at_utc at time zone c.customer_timezone, 'Mon FMDD, YYYY, FMHH12:MI AM')
              || ' (' || c.customer_timezone || ').',
            '/app/leads/' || c.lead_id::text,
            'callback-reminder:' || c.id::text)
    on conflict (tenant_id, recipient_user_id, source_key) do update
      set title = excluded.title, body = excluded.body, created_at = excluded.created_at, read_at = null;
    update public.tenant_callbacks set in_app_reminded_at = p_now where id = c.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.run_callback_in_app_reminders(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_callback_in_app_reminders(timestamptz, integer) to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- pg_cron is installed on this project (20260924250100 schedules the unclaimed-SLA ladder the
-- same way). cron.schedule with an existing job name replaces that job, so re-running is safe.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20260925708700: pg_cron is not installed; the callback jobs are not scheduled';
    return;
  end if;
  perform cron.schedule('callback-due', '* * * * *',
    $cron$select public.run_callback_due(now(), 500)$cron$);
  perform cron.schedule('callback-in-app-reminders', '* * * * *',
    $cron$select public.run_callback_in_app_reminders(now(), 200)$cron$);
  perform cron.schedule('callback-jobs-log-cleanup', '23 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname in ('callback-due', 'callback-in-app-reminders'))
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_release text;
  v_q public.lead_queue;
  v_member uuid;
  v_cb uuid;
  v_status text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708700: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.run_callback_due(timestamp with time zone, integer)'::regprocedure) into v_src;
  v_release := substr(v_src, strpos(v_src, '3 · released'));
  if strpos(v_src, '3 · released') = 0
     or strpos(v_release, 'and q.partner_id is null') = 0
     or strpos(v_release, 'and l.partner_id is null') = 0
     or strpos(v_release, 'where id = c.work_item_id and status = ''claimed'' and partner_id is null') = 0 then
    raise exception 'the 30-minute release does not exclude inbound partner leads';
  end if;
  if strpos(v_src, 'interval ''30 minutes''') = 0 then
    raise exception 'the release is not at 30 minutes overdue';
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and (select count(*) from cron.job where jobname in ('callback-due', 'callback-in-app-reminders')) <> 2 then
    raise exception 'the callback jobs are not scheduled';
  end if;

  -- Behaviour: an inbound work item held by its booked agent, a callback an hour overdue — the
  -- release must leave it claimed. Built and rolled back inside this block.
  begin
    select q.* into v_q
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.partner_id is not null
       and q.status in ('completed', 'dropped')
       and l.values->>'state' ~ '^[A-Za-z]{2}$'
     limit 1;
    if v_q.id is null then raise exception 'SKIP no inbound work item to test with'; end if;
    select tu.user_id into v_member
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_q.tenant_id and tu.accepted_at is not null and u.status::text = 'active'
       and tu.role::text in ('owner', 'producer', 'assistant')
     limit 1;
    if v_member is null then raise exception 'SKIP no active member on the inbound tenant'; end if;

    update public.tenant_callbacks set status = 'cancelled'
     where tenant_id = v_q.tenant_id and lead_id = v_q.lead_id and status in ('scheduled', 'due', 'missed');
    update public.lead_queue
       set status = 'claimed', owner_user_id = v_member, claimed_by = v_member, claimed_at = now(),
           locked_until = null, disposition = null, disposition_at = null, disposition_by = null
     where id = v_q.id;
    insert into public.tenant_callbacks
      (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, status, created_by,
       reopened_at, reopened_from)
    values
      (v_q.tenant_id, v_q.lead_id, v_q.id, now() - interval '1 hour', 'America/New_York', v_member, 'due', v_member,
       now() - interval '1 hour', jsonb_build_object('status', v_q.status, 'disposition', v_q.disposition))
    returning id into v_cb;

    perform public.run_callback_due(now(), 2000);

    -- Outside the customer's window right now the callback is missed first and its work item
    -- restored, which proves nothing about the release.
    if (select status from public.tenant_callbacks where id = v_cb) <> 'due' then
      raise exception 'SKIP the sample customer''s window is closed now';
    end if;
    select status into v_status from public.lead_queue where id = v_q.id;
    if v_status = 'unclaimed' then
      raise exception 'INBOUND_RELEASED';
    end if;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then
      raise notice '20260925708700: an overdue inbound callback stays with its booked agent';
    elsif sqlerrm = 'INBOUND_RELEASED' then
      raise exception 'the 30-minute release set an inbound transfer to unclaimed';
    else
      raise notice '20260925708700: inbound behaviour check skipped (%)', sqlerrm;
    end if;
  end;

  raise notice '20260925708700: callbacks come due with their agent, outbound ones release at 30 minutes, windows closing make a miss';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925708700', 'callbacks_come_due_on_a_schedule') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [18/18] 20260925709000_dialer_serves_due_callbacks.sql ────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Dialer · a due callback is actually served, and held by the agent it came back to
--
-- Callbacks (20260925708500) hands a due callback's work item back to its agent and offers two
-- helpers for the serving query, which this file wires in:
--
--   callback_work_item_holder(tenant, work_item)   who holds the item while a due callback has
--       handed it back to them (null otherwise, and null once released to the shared pool).
--   callback_tier_due(tenant, work_item, now)      a callback that is due AND has not been dialled
--       since it came due (from 15 minutes before).
--
-- Two changes, nothing else, restated from the latest on-disk bodies:
--   serve_next_lead        20260925700000
--   serve_lead_by_id       20260925700010
--   dialer_queue_preview   20260925700010
--   scoring_queue_preview  20260925701100 (Queue scoring's; its assertion requires its tier CASE to
--                          be serve_next_lead's, so it moves with it — its assertions are kept, with
--                          the assigned-to-you string updated to the new form)
--
-- (1) WHO HOLDS AN ITEM. Everywhere these functions asked lead_queue_assignee(p_tenant_id, q.id) —
--     the assigned-to-you branch of every candidate query, the pick's claimed branch, and BOTH
--     reclaim steps — they now ask
--         coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id))
--     so a due callback handed back to its agent is served to that agent as their own, and a lapsed
--     lock on it goes back to them (kept) rather than to the pool (reclaimed). This matters most for
--     an inbound partner callback: a reclaim that set its item to 'unclaimed' would put it in the
--     Transfer inbox. The assertion below checks both reclaim steps read the holder first.
--
-- (2) TIER 2. `exists (… tenant_callbacks … scheduled_at_utc <= v_now)` becomes
--         public.callback_tier_due(p_tenant_id, q.id, v_now)
--     so a no-answer on a due callback does not make it tier 2 again on the very next serve; the
--     call's own outcome decides when the lead comes back.
--
-- The capacity predicate (20260925700000), every gate and every assertion stay.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.callback_work_item_holder(uuid, uuid)') is null then
    raise exception 'callback_work_item_holder does not exist; apply 20260925708500 before this file';
  end if;
  if to_regprocedure('public.callback_tier_due(uuid, uuid, timestamp with time zone)') is null then
    raise exception 'callback_tier_due does not exist; apply 20260925708500 before this file';
  end if;
  if to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is null then
    raise exception 'agent_can_take_pool_lead does not exist; apply 20260925700000 before this file';
  end if;
end $$;

-- ── the serving query (from 20260925700000) ────────────────────────────────
create or replace function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  score numeric,
  cohort text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_candidate_cap integer := 50;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_own boolean := false;
  v_notes text;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_cohort text := 'control';
  v_serve_control boolean := false;
  v_score numeric;
  v_reason text;
  v_signals jsonb := '{}'::jsonb;
  v_tier_reason text;
  -- 20260925700000: may this agent take a lead from the unclaimed pool? Their own assigned leads
  -- are served either way.
  v_pool_ok boolean := true;
  s record;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  -- The reclaim. An abandoned lock returns the lead as well as the work item (20260913401000): a
  -- lead nobody dialled goes back to `fresh`, one with attempts to `retry`, due now. An ASSIGNED
  -- lead goes back to its assignee, unlocked; everything else goes back to the pool.
  with kept as (
    update lead_queue q
       set locked_until = null, updated_at = v_now
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and q.owner_user_id is not null
       and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = q.owner_user_id
    returning q.lead_id
  ), reclaimed as (
    update lead_queue q
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and (q.owner_user_id is null
            or coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) is distinct from q.owner_user_id)
    returning q.lead_id
  )
  update agent_leads l
     set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
         next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                                else least(coalesce(l.next_dial_after, v_now), v_now) end,
         updated_at = v_now
    from (select k.lead_id from kept k union select r.lead_id from reclaimed r) rc
   where l.id = rc.lead_id
     and l.tenant_id = p_tenant_id
     and l.lead_state = 'working';

  -- The open-lead ceiling, read after the reclaim (which can only lower the count).
  v_pool_ok := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id);

  -- The holdout is decided per serve so the control group is actually dialled; the cohort is a
  -- property of the lead so its outcome stays attributable.
  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  if v_enabled and not v_serve_control then
    -- ── scored path ────────────────────────────────────────────────────────
    with eligible as materialized (
      select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      -- The scheduler's choice. Only ever an already-used slot when every slot has
                      -- been used, which is the least-recently-used fallback decision 2 requires.
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
         )
         -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
         and (q.status <> 'unclaimed' or v_pool_ok)
         and (abs(hashtextextended(q.lead_id::text, 42)) % 100) >= v_holdout
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
         and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
    ),
    candidates as (
      -- ONE reference to `eligible`, which is why the tier filter is an ORDER BY rather than a
      -- `priority = (select min(priority) from eligible)`.
      select e.*
        from eligible e
       where e.priority is not null
       order by e.priority, coalesce(e.posted_at, e.queued_at) desc
       limit v_candidate_cap
    )
    -- `priority` leads the final ordering too: scoring orders WITHIN a tier; it does not get a
    -- vote on which tier comes first.
    select c.qid, c.lid, c.priority, c.own
      into v_qid, v_lead, v_priority, v_own
      from candidates c
      cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl
     order by c.priority,
              sl.score desc,
              -ln(greatest(random(), 1e-9)) / greatest(c.weight, 1),
              coalesce(c.posted_at, c.queued_at)
     limit 1;
    v_cohort := 'scored';
  end if;

  -- ── naive path ─────────────────────────────────────────────────────────
  --
  -- Runs when scoring is off, when this serve drew the holdout, and when the scored pool turned
  -- out to be empty. The cohort filter is applied only while the holdout is being served.
  if v_qid is null then
    with eligible as (
      select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and (
               (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
            or (q.status = 'claimed'
                and q.owner_user_id = p_agent_user_id
                and q.claimed_by = p_agent_user_id
                and q.locked_until is null
                and q.disposition is null
                and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
         )
         -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
         and (q.status <> 'unclaimed' or v_pool_ok)
         and (not v_serve_control
              or (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout)
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
         and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
    )
    select e.qid, e.lid, e.priority, e.own
      into v_qid, v_lead, v_priority, v_own
      from eligible e
     where e.priority is not null
     order by e.priority,
              -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
              coalesce(e.posted_at, e.queued_at)
     limit 1;

    if v_qid is not null then
      v_cohort := case
        when not v_enabled then 'control'
        when (abs(hashtextextended(v_lead::text, 42)) % 100) < v_holdout then 'control'
        else 'scored' end;
    end if;
  end if;

  if v_qid is null then
    return;
  end if;

  -- The claim. The status re-check on the pool path is the race guard: a second agent who chose
  -- the same lead a moment later updates nothing and is served nothing.
  if not coalesce(v_own, false) then
    update lead_queue q
       set status = 'claimed',
           claimed_by = p_agent_user_id,
           owner_user_id = p_agent_user_id,
           claimed_at = v_now,
           locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_qid and q.status = 'unclaimed';
  else
    -- Already the agent's. Locked for the call; claimed_at stays the assignment time.
    update lead_queue q
       set locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_qid
       and q.status = 'claimed'
       and q.owner_user_id = p_agent_user_id
       and q.locked_until is null;
  end if;

  if not found then
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_lead and l.tenant_id = p_tenant_id;

  if v_priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_lead
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  -- THE REASON, ALWAYS.
  v_tier_reason := case v_priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;
  if coalesce(v_own, false) then
    v_tier_reason := v_tier_reason || ' (assigned to you)';
  end if;

  if v_enabled and v_cohort = 'scored' then
    select sl.score, sl.reasons, sl.signals into s from score_lead(p_tenant_id, v_lead, v_now) sl;
    v_score := s.score;
    v_signals := coalesce(s.signals, '{}'::jsonb);
    v_reason := v_tier_reason || case
      when array_length(s.reasons, 1) > 0 then ' — ' || array_to_string(s.reasons, '; ')
      else '' end;
  else
    v_reason := v_tier_reason || case
      when v_enabled then ' — served in the naive order, as part of the holdout'
      else '' end;
    v_score := null;
  end if;

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_lead, v_qid, p_agent_user_id, v_cohort, v_score, v_signals, v_reason, v_now);

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           v_score,
           v_cohort;
end;
$function$;

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── the pick (from 20260925700010) ─────────────────────────────────────────
create or replace function public.serve_lead_by_id(p_tenant_id uuid, p_agent_user_id uuid, p_work_item_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  cohort text,
  refusal text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_q lead_queue%rowtype;
  v_own boolean := false;
  v_row record;
  v_notes text;
  v_tier_reason text;
  v_reason text;
begin
  -- The same reclaim serve_next_lead runs, so a lock another agent abandoned is pickable and the
  -- lead it held is restored first.
  with kept as (
    update lead_queue q
       set locked_until = null, updated_at = v_now
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and q.owner_user_id is not null
       and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = q.owner_user_id
    returning q.lead_id
  ), reclaimed as (
    update lead_queue q
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
     where q.tenant_id = p_tenant_id
       and q.status = 'claimed'
       and q.locked_until is not null
       and q.locked_until < v_now
       and (q.owner_user_id is null
            or coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) is distinct from q.owner_user_id)
    returning q.lead_id
  )
  update agent_leads l
     set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
         next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                                else least(coalesce(l.next_dial_after, v_now), v_now) end,
         updated_at = v_now
    from (select k.lead_id from kept k union select r.lead_id from reclaimed r) rc
   where l.id = rc.lead_id
     and l.tenant_id = p_tenant_id
     and l.lead_state = 'working';

  -- The lock. Everything below reads the row this transaction now owns.
  select * into v_q from lead_queue q
   where q.id = p_work_item_id and q.tenant_id = p_tenant_id
   for update;
  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_found'::text;
    return;
  end if;

  if v_q.status = 'claimed' and v_q.claimed_by = p_agent_user_id
     and v_q.locked_until is not null and v_q.locked_until >= v_now then
    -- Already locked to this agent (served a moment ago). Nothing to claim; say so.
    return query select v_q.id, v_q.lead_id, null::integer, null::text, v_q.locked_until, null::text, null::text, null::text, 'held_by_you'::text;
    return;
  elsif v_q.status = 'unclaimed' and (v_q.locked_until is null or v_q.locked_until < v_now) then
    v_own := false;
  elsif v_q.status = 'claimed'
        and v_q.owner_user_id = p_agent_user_id
        and v_q.claimed_by = p_agent_user_id
        and v_q.locked_until is null
        and v_q.disposition is null
        and coalesce(public.callback_work_item_holder(p_tenant_id, v_q.id), lead_queue_assignee(p_tenant_id, v_q.id)) = p_agent_user_id then
    v_own := true;
  else
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'taken'::text;
    return;
  end if;

  -- 20260925700000: a POOL lead is refused to an agent at their open-lead ceiling, as Serve next
  -- refuses it. A lead already assigned to them is theirs and is not counted against the pick.
  if not v_own and not agent_can_take_pool_lead(p_tenant_id, p_agent_user_id) then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'at_capacity'::text;
    return;
  end if;

  -- Every predicate serve_next_lead applies to a candidate, evaluated one by one so a refusal
  -- names its rule. The tier CASE is serve_next_lead's, character for character.
  select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
         (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id)) as campaign_ok,
         sup.suppressed as suppressed,
         sup.list_type as list_type,
         tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now) as window_ok,
         (l.lead_state <> 'exhausted') as not_exhausted,
         agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state') as licensed
    into v_row
    from lead_queue q
    join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    cross join lateral is_phone_suppressed(p_tenant_id, l.values->>'phone') sup
   where q.tenant_id = p_tenant_id and q.id = v_q.id;

  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_found'::text;
    return;
  end if;
  -- `is not true` / `is not false`, as the serving WHERE clause reads them: a null is a refusal.
  if v_row.not_exhausted is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'exhausted'::text; return;
  end if;
  if v_row.campaign_ok is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'campaign_not_servable'::text; return;
  end if;
  if v_row.suppressed is not false then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, ('suppressed:' || coalesce(v_row.list_type, 'unknown'))::text; return;
  end if;
  if v_row.window_ok is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'outside_window'::text; return;
  end if;
  if v_row.licensed is not true then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_licensed'::text; return;
  end if;
  if v_row.priority is null then
    return query select null::uuid, v_q.lead_id, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'not_due'::text; return;
  end if;

  -- The claim, as serve_next_lead makes it. The row is locked, so the status re-check cannot lose a
  -- race here; it is kept so the two claims read the same.
  if not v_own then
    update lead_queue q
       set status = 'claimed',
           claimed_by = p_agent_user_id,
           owner_user_id = p_agent_user_id,
           claimed_at = v_now,
           locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_q.id and q.status = 'unclaimed';
  else
    update lead_queue q
       set locked_until = v_now + make_interval(mins => v_lock_minutes),
           updated_at = v_now
     where q.id = v_q.id
       and q.status = 'claimed'
       and q.owner_user_id = p_agent_user_id
       and q.locked_until is null;
  end if;
  if not found then
    return query select null::uuid, null::uuid, null::integer, null::text, null::timestamptz, null::text, null::text, null::text, 'taken'::text;
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_q.lead_id and l.tenant_id = p_tenant_id;

  if v_row.priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_q.lead_id
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  v_tier_reason := case v_row.priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;
  v_reason := 'You picked this lead from the queue. ' || v_tier_reason
              || case when v_own then ' (assigned to you)' else '' end || '.';

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_q.lead_id, v_q.id, p_agent_user_id, 'picked', null, '{}'::jsonb, v_reason, v_now);

  return query
    select v_q.id, v_q.lead_id, v_row.priority::integer,
           case v_row.priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           'picked'::text,
           null::text;
end;
$function$;

revoke all on function public.serve_lead_by_id(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_lead_by_id(uuid, uuid, uuid) to tenant_app, service_role;

-- ── the list (from 20260925700010) ─────────────────────────────────────────
create or replace function public.dialer_queue_preview(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_tiers integer[] default null,
  p_limit integer default 25,
  p_cap integer default 1000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_cap integer := least(greatest(coalesce(p_cap, 1000), 1), 5000);
  v_count integer;
  v_rows jsonb;
  v_pool_ok boolean := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id);
begin
  with eligible as materialized (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
           l.values as vals, coalesce(l.attempts_made, 0) as attempts_made,
           l.posted_at as posted_at, q.queued_at as queued_at
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and (
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now))
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null
              and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
       )
       -- 20260925700000: a pool lead only while the agent is under their open-lead ceiling.
       and (q.status <> 'unclaimed' or v_pool_ok)
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
       and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
       and l.lead_state <> 'exhausted'
       and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
  ),
  servable as (
    select e.* from eligible e where e.priority is not null
  )
  select (select count(*)::integer from (select 1 from servable limit v_cap + 1) capped),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'work_item_id', r.qid,
                    'lead_id', r.lid,
                    'tier', r.priority,
                    'tier_name', case r.priority
                                   when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                                   when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
                    'name', coalesce(nullif(btrim(r.vals->>'full_name'), ''),
                                     nullif(btrim(concat_ws(' ', r.vals->>'first_name', r.vals->>'last_name')), ''),
                                     nullif(btrim(r.vals->>'name'), '')),
                    'state', nullif(upper(btrim(coalesce(r.vals->>'state', ''))), ''),
                    'attempts_made', r.attempts_made,
                    'assigned_to_you', r.own
                  ) order by r.priority, coalesce(r.posted_at, r.queued_at) desc)
             from (
               select s.* from servable s
                where p_tiers is null or s.priority = any(p_tiers)
                order by s.priority, coalesce(s.posted_at, s.queued_at) desc
                limit v_limit
             ) r
         ), '[]'::jsonb)
    into v_count, v_rows;

  return jsonb_build_object(
    'count', least(v_count, v_cap),
    'capped', v_count > v_cap,
    'cap', v_cap,
    'rows', v_rows
  );
end;
$function$;

revoke all on function public.dialer_queue_preview(uuid, uuid, integer[], integer, integer) from public, anon, authenticated;
grant execute on function public.dialer_queue_preview(uuid, uuid, integer[], integer, integer) to tenant_app, service_role;

-- ── the scoring preview (from 20260925701100) ──────────────────────────────
create or replace function public.scoring_queue_preview(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_candidate_cap integer := 50;
  v_held_limit integer := 10;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_total numeric := 0;
  v_capacity_gate boolean := to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is not null;
  v_pool_open boolean := true;
  v_result jsonb;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  select coalesce(sum(w.weight), 0) into v_total from scoring_weights_for(p_tenant_id) w;

  if v_capacity_gate then
    execute 'select public.agent_can_take_pool_lead($1, $2)' into v_pool_open using p_tenant_id, p_agent_user_id;
    v_pool_open := coalesce(v_pool_open, true);
  end if;

  with base as materialized (
    select q.id as qid, q.lead_id as lid, (q.status = 'claimed') as own,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when public.callback_tier_due(p_tenant_id, q.id, v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
           l.values as vals,
           l.values->>'state' as raw_state,
           l.campaign_id as campaign_id,
           coalesce(l.attempts_made, 0) as attempts_made,
           coalesce(l.posted_at, q.queued_at) as aged_at,
           (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout as in_holdout
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and (
             (q.status = 'unclaimed' and (q.locked_until is null or q.locked_until < v_now) and v_pool_open)
          or (q.status = 'claimed'
              and q.owner_user_id = p_agent_user_id
              and q.claimed_by = p_agent_user_id
              and q.locked_until is null
              and q.disposition is null
              and coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id)
       )
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
       and l.lead_state <> 'exhausted'
       and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>'state')
  ),
  due as (
    select b.* from base b where b.priority is not null
  ),
  -- The calling window, once per (state, campaign). The explainer runs only where it is closed.
  windows as materialized (
    select k.raw_state, k.campaign_id, k.can_dial,
           w.reason as window_reason, w.zone, w.start_minute, w.local_minute
      from (
        select d.raw_state, d.campaign_id,
               tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, v_now) as can_dial
          from (select distinct u.raw_state, u.campaign_id from due u) d
      ) k
      left join lateral (
        select tw.reason, tw.zone, tw.start_minute, tw.local_minute
          from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, v_now) tw
         where not k.can_dial
      ) w on true
  ),
  servable as materialized (
    select u.* from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where k.can_dial
  ),
  held as materialized (
    select u.*, k.window_reason, k.zone, k.start_minute, k.local_minute,
           case when k.window_reason = 'before_open' and k.start_minute is not null and k.local_minute is not null
                then greatest(k.start_minute - k.local_minute, 0) end as minutes_until_open
      from due u
      join windows k on k.raw_state is not distinct from u.raw_state
                    and k.campaign_id is not distinct from u.campaign_id
     where not k.can_dial
  ),
  -- Scoring on: the scored path serves the scored cohort, and falls back to everyone when that
  -- cohort has nothing servable. Scoring off: everyone, in the plain order.
  mode as (
    select v_enabled and exists (select 1 from servable s where not s.in_holdout) as ranked
  ),
  candidates as (
    select s.*
      from servable s, mode m
     where not m.ranked or not s.in_holdout
     order by s.priority,
              case when m.ranked then -extract(epoch from s.aged_at) else extract(epoch from s.aged_at) end
     limit v_candidate_cap
  ),
  scored as (
    select c.*, sl.score, sl.reasons
      from candidates c
      cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl
  ),
  ordered as (
    select sc.*,
           row_number() over (
             order by sc.priority,
                      case when m.ranked then sc.score end desc nulls last,
                      case when m.ranked then 0 else extract(epoch from sc.aged_at) end,
                      sc.aged_at
           ) as position
      from scored sc, mode m
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'enabled', v_enabled,
    'ranked', (select m.ranked from mode m),
    'holdout_pct', v_holdout,
    'total_weight', v_total,
    'capacity_gate', v_capacity_gate,
    'pool_open', v_pool_open,
    'servable_count', (select count(*)::integer from servable),
    'held_back_count', (select count(*)::integer from held),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'position', o.position,
               'work_item_id', o.qid,
               'lead_id', o.lid,
               'name', coalesce(nullif(btrim(o.vals->>'full_name'), ''),
                                nullif(btrim(concat_ws(' ', o.vals->>'first_name', o.vals->>'last_name')), ''),
                                nullif(btrim(o.vals->>'name'), '')),
               'state', nullif(upper(btrim(coalesce(o.raw_state, ''))), ''),
               'attempts_made', o.attempts_made,
               'tier', o.priority,
               'tier_name', case o.priority
                              when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                              when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
               'tier_reason', (case o.priority
                                 when 1 then 'Posted less than five minutes ago'
                                 when 2 then 'A callback you promised is due'
                                 when 3 then 'An appointment a setter booked is due'
                                 when 4 then 'Due for a retry, in a slot it has not been tried in'
                                 when 5 then 'A fresh lead that has never been called'
                                 when 6 then 'Due for a nurture touch'
                               end) || case when o.own then ' (assigned to you)' else '' end,
               'assigned_to_you', o.own,
               'cohort', case when not v_enabled then null
                              when o.in_holdout then 'control' else 'scored' end,
               'score', o.score,
               'reasons', to_jsonb(coalesce(o.reasons, array[]::text[]))
             ) order by o.position)
        from ordered o
       where o.position <= v_limit
    ), '[]'::jsonb),
    'held_back', coalesce((
      select jsonb_agg(jsonb_build_object(
               'work_item_id', h.qid,
               'lead_id', h.lid,
               'name', coalesce(nullif(btrim(h.vals->>'full_name'), ''),
                                nullif(btrim(concat_ws(' ', h.vals->>'first_name', h.vals->>'last_name')), ''),
                                nullif(btrim(h.vals->>'name'), '')),
               'state', nullif(upper(btrim(coalesce(h.raw_state, ''))), ''),
               'attempts_made', h.attempts_made,
               'tier_name', case h.priority
                              when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
                              when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
               'reason', coalesce(h.window_reason, 'closed'),
               'zone', h.zone,
               'start_minute', h.start_minute,
               'local_minute', h.local_minute,
               'minutes_until_open', h.minutes_until_open
             ) order by h.minutes_until_open nulls last, h.priority, h.aged_at)
        from (
          select * from held hh
           order by hh.minutes_until_open nulls last, hh.priority, hh.aged_at
           limit v_held_limit
        ) h
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.scoring_queue_preview(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.scoring_queue_preview(uuid, uuid, integer) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_serve text;
  v_pick text;
  v_preview text;
  v_scoring text;
  v_scoring_flat text;
  v_serve_case text;
  v_fn text;
  v_body text;
  v_n integer;
  v_holder constant text := 'coalesce(public.callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id))';
  v_tenant uuid;
  v_agent uuid;
  v_out jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.serve_next_lead(uuid, uuid)'::regprocedure) into v_serve;
  select pg_get_functiondef('public.serve_lead_by_id(uuid, uuid, uuid)'::regprocedure) into v_pick;
  select pg_get_functiondef('public.dialer_queue_preview(uuid, uuid, integer[], integer, integer)'::regprocedure) into v_preview;
  select pg_get_functiondef('public.scoring_queue_preview(uuid, uuid, integer)'::regprocedure) into v_scoring;
  v_scoring_flat := regexp_replace(regexp_replace(v_scoring, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');

  -- (1) The holder is asked first: both candidate paths, the pick, both lists.
  v_n := (length(v_serve) - length(replace(v_serve, v_holder || ' = p_agent_user_id', ''))) / length(v_holder || ' = p_agent_user_id');
  if v_n <> 2 then raise exception 'serve_next_lead: the callback holder is on % candidate paths, not 2', v_n; end if;
  if strpos(v_pick, 'coalesce(public.callback_work_item_holder(p_tenant_id, v_q.id), lead_queue_assignee(p_tenant_id, v_q.id)) = p_agent_user_id') = 0 then
    raise exception 'serve_lead_by_id: the claimed branch does not ask the callback holder';
  end if;
  if strpos(v_preview, v_holder || ' = p_agent_user_id') = 0 then
    raise exception 'dialer_queue_preview does not ask the callback holder';
  end if;

  -- (1) THE RECLAIM. In both functions that reclaim, both steps read the holder, and no bare
  -- lead_queue_assignee comparison is left: an inbound partner callback handed back to its agent is
  -- kept for them, never set to 'unclaimed' (which would put it in the Transfer inbox).
  foreach v_fn in array array['serve_next_lead', 'serve_lead_by_id'] loop
    v_body := case v_fn when 'serve_next_lead' then v_serve else v_pick end;
    if strpos(v_body, v_holder || ' = q.owner_user_id') = 0 then
      raise exception '%: the kept step of the reclaim does not ask the callback holder', v_fn;
    end if;
    if strpos(v_body, v_holder || ' is distinct from q.owner_user_id') = 0 then
      raise exception '%: the reclaimed step could set a held callback''s item to unclaimed', v_fn;
    end if;
    if v_body ~ '[^,] lead_queue_assignee\(p_tenant_id, (q|v_q)\.id\) (=|is distinct)' then
      raise exception '%: a lead_queue_assignee comparison does not ask the callback holder first', v_fn;
    end if;
  end loop;

  -- (2) Tier 2 is callback_tier_due everywhere, and the old due-callback read is gone.
  select count(*) into v_n from regexp_matches(v_serve, 'public\.callback_tier_due\(p_tenant_id, q\.id, v_now\) then 2', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: tier 2 reads callback_tier_due on % paths, not 2', v_n; end if;
  foreach v_fn in array array['serve_next_lead', 'serve_lead_by_id', 'dialer_queue_preview', 'scoring_queue_preview'] loop
    v_body := case v_fn when 'serve_next_lead' then v_serve when 'serve_lead_by_id' then v_pick when 'dialer_queue_preview' then v_preview else v_scoring end;
    if strpos(v_body, 'from tenant_callbacks cb') > 0 then
      raise exception '%: tier 2 still reads tenant_callbacks directly', v_fn;
    end if;
  end loop;

  -- 20260925700000's assertions on serve_next_lead.
  select count(*) into v_n from regexp_matches(v_serve, 'q\.status <> ''unclaimed'' or v_pool_ok', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: the capacity predicate is on % candidate paths, not 2', v_n; end if;
  if strpos(v_serve, 'v_pool_ok := agent_can_take_pool_lead(p_tenant_id, p_agent_user_id)') = 0 then
    raise exception 'serve_next_lead does not read agent_can_take_pool_lead';
  end if;
  if (length(v_serve) - length(replace(v_serve, 'agent_may_work_state(p_tenant_id, p_agent_user_id', ''))) / length('agent_may_work_state(p_tenant_id, p_agent_user_id') <> 2 then
    raise exception 'serve_next_lead: the licence filter is not in both candidate queries';
  end if;
  select count(*) into v_n from regexp_matches(v_serve, 'is_phone_suppressed\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: suppression is not checked on both paths (found %)', v_n; end if;
  select count(*) into v_n from regexp_matches(v_serve, 'tenant_can_dial_now\(p_tenant_id', 'g');
  if v_n <> 2 then raise exception 'serve_next_lead: the calling window is not checked on both paths (found %)', v_n; end if;
  if v_serve !~ 'reclaimed as' or v_serve !~ 'kept as' or v_serve !~ 'set lead_state = case when coalesce\(l\.attempts_made, 0\) = 0' then
    raise exception 'serve_next_lead: the reclaim no longer restores the lead';
  end if;
  if v_serve !~ 'where q\.id = v_qid and q\.status = ''unclaimed''' then
    raise exception 'serve_next_lead: the pool claim lost its race guard';
  end if;

  -- 20260925700010's assertions on the pick and the list.
  if strpos(v_pick, 'agent_can_take_pool_lead(p_tenant_id, p_agent_user_id)') = 0 or strpos(v_pick, 'at_capacity') = 0 then
    raise exception 'serve_lead_by_id does not refuse a pool pick at capacity';
  end if;
  if strpos(v_preview, 'q.status <> ''unclaimed'' or v_pool_ok') = 0 then
    raise exception 'dialer_queue_preview offers pool leads to an agent at capacity';
  end if;
  v_serve_case := substring(
    regexp_replace(regexp_replace(v_serve, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    from 'case when l\.posted_at is not null.*?end as priority');
  if v_serve_case is null then raise exception 'could not find the tier CASE in serve_next_lead'; end if;
  foreach v_fn in array array['serve_lead_by_id', 'dialer_queue_preview'] loop
    v_body := case v_fn when 'serve_lead_by_id' then v_pick else v_preview end;
    if strpos(regexp_replace(regexp_replace(v_body, '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), v_serve_case) = 0 then
      raise exception '%: its tier CASE differs from serve_next_lead''s', v_fn;
    end if;
    if strpos(v_body, 'campaigns_servable') = 0 or strpos(v_body, 'is_phone_suppressed(p_tenant_id') = 0
       or strpos(v_body, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_body, 'agent_may_work_state(p_tenant_id, p_agent_user_id') = 0
       or strpos(v_body, 'lead_state <> ''exhausted''') = 0 or strpos(v_body, 'lead_queue_assignee(p_tenant_id') = 0 then
      raise exception '%: a serving gate is missing', v_fn;
    end if;
  end loop;

  -- 20260925701100's assertions on scoring_queue_preview, kept. The assigned-to-you string is the
  -- new holder-first form (it was 'lead_queue_assignee(p_tenant_id, q.id) = p_agent_user_id').
  if strpos(v_scoring_flat, v_serve_case) = 0 then
    raise exception '20260925701100: scoring_queue_preview''s tier CASE differs from serve_next_lead''s';
  end if;
  if strpos(v_scoring, 'campaigns_servable') = 0 or strpos(v_scoring, 'is_phone_suppressed(p_tenant_id') = 0
     or strpos(v_scoring, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_scoring, 'agent_may_work_state(p_tenant_id, p_agent_user_id') = 0
     or strpos(v_scoring, 'lead_state <> ''exhausted''') = 0 or strpos(v_scoring, v_holder || ' = p_agent_user_id') = 0
     or strpos(v_scoring, 'hashtextextended(q.lead_id::text, 42)') = 0 then
    raise exception '20260925701100: a serving gate is missing from scoring_queue_preview';
  end if;
  if strpos(v_serve, 'agent_can_take_pool_lead') > 0 and strpos(v_scoring, 'agent_can_take_pool_lead') = 0 then
    raise exception '20260925701100: serve_next_lead applies the capacity gate and the preview does not';
  end if;
  if v_scoring_flat ~* '\m(insert\s+into|delete\s+from|update\s+[a-z_]+\s+(q|l|d)?\s*set)\M' then
    raise exception '20260925701100: scoring_queue_preview writes; it must be read-only';
  end if;
  if (select provolatile from pg_proc where oid = 'public.scoring_queue_preview(uuid, uuid, integer)'::regprocedure) <> 's' then
    raise exception '20260925701100: scoring_queue_preview is not STABLE';
  end if;
  if not has_function_privilege('tenant_app', 'public.scoring_queue_preview(uuid, uuid, integer)', 'execute') then
    raise exception '20260925701100: tenant_app cannot execute scoring_queue_preview';
  end if;
  select q.tenant_id into v_tenant from public.lead_queue q group by q.tenant_id order by count(*) desc limit 1;
  if v_tenant is not null then
    select tu.user_id into v_agent from public.tenant_users tu
     where tu.tenant_id = v_tenant and tu.role in ('owner', 'producer', 'setter') and tu.accepted_at is not null
     limit 1;
  end if;
  if v_agent is null then
    raise notice '20260925709000: no queued tenant with a dialing member; the live preview run was skipped';
  else
    v_out := public.scoring_queue_preview(v_tenant, v_agent, 5);
    if jsonb_typeof(v_out->'rows') <> 'array' or jsonb_typeof(v_out->'held_back') <> 'array'
       or v_out->'total_weight' is null or jsonb_array_length(v_out->'rows') > 5 then
      raise exception '20260925701100: scoring_queue_preview returned an unexpected shape: %', left(v_out::text, 400);
    end if;
  end if;

  raise notice '20260925709000: due callbacks are served to the agent holding them, once per due time';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709000', 'dialer_serves_due_callbacks') on conflict do nothing;
  end if;
end $bundle$;
commit;
