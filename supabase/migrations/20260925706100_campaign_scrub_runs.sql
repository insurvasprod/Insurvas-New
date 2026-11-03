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
