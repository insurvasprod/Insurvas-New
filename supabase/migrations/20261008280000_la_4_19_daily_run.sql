-- LA-4.19 (Notion sprint) · the orchestrated run and the agent framework.
--
-- One run per agency each time files are waiting (the five-minute poll, a door's arrival, or by
-- hand): every waiting file walks the stages in order — COLLECT, INGEST, PARSE, STORE, MATCH,
-- RECONCILE — and the agency's day is then ANALYSEd. Different files run side by side.
--
--   pipeline_run          one per agency per run: trigger, status, files total / succeeded / failed.
--   pipeline_stage_run    one per file per stage (ANALYSE: one per run): status, timings, rows in
--                         and out, the error, the agent findings it raised. A run that died is
--                         marked failed by the next one, which resumes each file after its last
--                         completed stage; every stage is idempotent, so running one twice is harmless.
--   file_registry.pipeline_completed_at   when a file finished every stage (existing derived files
--                         are back-filled, so nothing old is run again).
--   agent_findings        (LA-4.3) now tied to its run; indexed by model id and prompt version.
--   agent_accuracy_weekly approved ÷ (approved + rejected) per agent per week: the human corrections.
--   file_monitor_sweep    the file monitor, deterministic: a carrier the agency expects daily
--                         (business days), weekly or monthly (LA-4.17 expected_cadence) that sent
--                         nothing by its due day raises a missing-file finding the next morning;
--                         when the file comes it resolves itself and a late-file note is left; every
--                         duplicate skipped is noted. An ad-hoc or unset carrier never raises one.
--   insurvas_agent        the role agent code runs as: it reads, and may only insert findings.
--                         UPDATE and DELETE on raw_rows and commission_entry fail for it.
--
-- Additive. Requires 20261008100000..20261008270000.
--
-- Rollback:
--   select cron.unschedule('la4-file-monitor-daily');
--   drop view if exists public.agent_accuracy_weekly;
--   drop function if exists public.file_monitor_sweep(date);
--   alter table public.agent_findings drop constraint if exists agent_findings_run_fk;
--   alter table public.file_registry drop column if exists pipeline_completed_at;
--   drop table if exists public.pipeline_stage_run, public.pipeline_run;
--   revoke all on all tables in schema public from insurvas_agent; drop role if exists insurvas_agent;

create table if not exists public.pipeline_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger text not null,
  status text not null default 'running',
  files_total integer not null default 0,
  files_succeeded integer not null default 0,
  files_failed integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_detail text,
  constraint pipeline_run_trigger check (trigger in ('scheduled', 'manual', 'file_arrival', 'reprocess')),
  constraint pipeline_run_status check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint pipeline_run_finished check ((status = 'running') = (finished_at is null)),
  constraint pipeline_run_counts check (files_total >= 0 and files_succeeded >= 0 and files_failed >= 0 and files_succeeded + files_failed <= files_total),
  constraint pipeline_run_error check (error_detail is null or char_length(error_detail) <= 2000)
);
create index if not exists pipeline_run_tenant_idx on public.pipeline_run (tenant_id, started_at desc);
create index if not exists pipeline_run_running_idx on public.pipeline_run (started_at) where status = 'running';

create table if not exists public.pipeline_stage_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.pipeline_run(id) on delete cascade,
  file_id uuid references public.file_registry(id) on delete cascade,
  stage text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_in integer,
  rows_out integer,
  error_detail text,
  note text,
  agent_findings_count integer not null default 0,
  constraint pipeline_stage_run_stage check (stage in ('collect', 'ingest', 'parse', 'store', 'match', 'reconcile', 'analyse')),
  constraint pipeline_stage_run_status check (status in ('running', 'succeeded', 'skipped', 'blocked', 'failed')),
  constraint pipeline_stage_run_finished check ((status = 'running') = (finished_at is null)),
  constraint pipeline_stage_run_failed check (status not in ('failed', 'blocked') or error_detail is not null),
  constraint pipeline_stage_run_text check ((error_detail is null or char_length(error_detail) <= 2000) and (note is null or char_length(note) <= 500)),
  constraint pipeline_stage_run_rows check ((rows_in is null or rows_in >= 0) and (rows_out is null or rows_out >= 0) and agent_findings_count >= 0),
  constraint pipeline_stage_run_file check ((stage = 'analyse') = (file_id is null))
);
create unique index if not exists pipeline_stage_run_once on public.pipeline_stage_run (run_id, coalesce(file_id, '00000000-0000-0000-0000-000000000000'::uuid), stage);
create index if not exists pipeline_stage_run_file_idx on public.pipeline_stage_run (file_id, stage, finished_at desc) where file_id is not null;
create index if not exists pipeline_stage_run_tenant_idx on public.pipeline_stage_run (tenant_id, started_at desc);

alter table public.file_registry add column if not exists pipeline_completed_at timestamptz;
-- Everything already read is complete: the new run never picks up an old file again.
update public.file_registry
   set pipeline_completed_at = coalesce(derived_at, parsed_at, received_at)
 where pipeline_completed_at is null
   and (status = 'superseded'
        or (status = 'parsed' and (derived_at is not null or file_type not in ('policies', 'commissions'))));
create index if not exists file_registry_pipeline_pending_idx on public.file_registry (received_at) where pipeline_completed_at is null and status = 'parsed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_findings_run_fk') then
    alter table public.agent_findings add constraint agent_findings_run_fk foreign key (run_id) references public.pipeline_run(id) on delete set null;
  end if;
end $$;
create index if not exists agent_findings_run_idx on public.agent_findings (run_id) where run_id is not null;
create index if not exists agent_findings_model_idx on public.agent_findings (tenant_id, agent_name, model_id, prompt_version);
create index if not exists agent_findings_open_idx on public.agent_findings (tenant_id, status, created_at desc);

-- ─── the human corrections, per agent per week ──────────────────────────────────────────────────
create or replace view public.agent_accuracy_weekly
with (security_invoker = true) as
select f.tenant_id, f.agent_name,
       date_trunc('week', f.reviewed_at)::date as week_start,
       count(*) filter (where f.status = 'approved') as approved,
       count(*) filter (where f.status = 'rejected') as rejected,
       count(*) as reviewed
  from public.agent_findings f
 where f.reviewed_at is not null and f.status in ('approved', 'rejected')
 group by 1, 2, 3;

-- ─── the file monitor ───────────────────────────────────────────────────────────────────────────
create or replace function public.file_monitor_sweep(p_as_of date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'UTC')::date);
  v_missing integer := 0;
  v_late integer := 0;
  v_resolved integer := 0;
  v_duplicates integer := 0;
  r record;
  v_due date;
begin
  -- 1. A file arrived after its missing-file finding: resolve it, and say how late it was.
  for r in
    select f.id, f.tenant_id, f.payload, (f.payload->>'carrier_id')::uuid as carrier_id, (f.payload->>'due')::date as due,
           (select min(fr.received_at) from public.file_registry fr
             where fr.tenant_id = f.tenant_id and fr.carrier_id = (f.payload->>'carrier_id')::uuid and fr.received_at > f.created_at) as arrived_at
      from public.agent_findings f
     where f.agent_name = 'file_monitor' and f.finding_type = 'missing_file' and f.status = 'open'
  loop
    continue when r.arrived_at is null;
    update public.agent_findings set status = 'auto_resolved', payload = r.payload || jsonb_build_object('arrived_at', r.arrived_at) where id = r.id;
    v_resolved := v_resolved + 1;
    insert into public.agent_findings (tenant_id, agent_name, finding_type, severity, payload, reasoning, status, dedupe_key)
    values (r.tenant_id, 'file_monitor', 'late_file', 'info',
            jsonb_build_object('carrier_id', r.carrier_id, 'due', r.due, 'arrived_at', r.arrived_at, 'days_late', (r.arrived_at::date - r.due)),
            format('The file was due on %s and arrived on %s, %s %s late.', to_char(r.due, 'FMMon FMDD, YYYY'), to_char(r.arrived_at, 'FMMon FMDD, YYYY'),
                   (r.arrived_at::date - r.due), case when (r.arrived_at::date - r.due) = 1 then 'day' else 'days' end),
            'auto_resolved', 'late_file:' || r.carrier_id::text || ':' || r.due::text)
    on conflict (tenant_id, dedupe_key) do nothing;
    if found then v_late := v_late + 1; end if;
  end loop;

  -- 2. A carrier with an expected cadence that sent nothing by its due day.
  for r in
    with expected as (
      select distinct on (fr.tenant_id, fr.carrier_id) fr.tenant_id, fr.carrier_id,
             coalesce(ag.expected_cadence, pf.expected_cadence) as cadence
        from public.file_registry fr
        left join public.carrier_operating_settings ag on ag.tenant_id = fr.tenant_id and ag.carrier_id = fr.carrier_id
        left join public.carrier_operating_settings pf on pf.tenant_id is null and pf.carrier_id = fr.carrier_id
       where fr.carrier_id is not null
    )
    select e.tenant_id, e.carrier_id, e.cadence, c.name as carrier_name,
           (select max(fr.received_at) from public.file_registry fr where fr.tenant_id = e.tenant_id and fr.carrier_id = e.carrier_id) as last_at
      from expected e
      join public.carriers c on c.id = e.carrier_id
     where e.cadence in ('daily', 'weekly', 'monthly')
  loop
    continue when r.last_at is null;
    v_due := case r.cadence
               when 'weekly' then r.last_at::date + 7
               when 'monthly' then (r.last_at::date + interval '1 month')::date
               -- daily: the next business day after the last file
               else r.last_at::date + case extract(isodow from r.last_at::date)::int when 5 then 3 when 6 then 2 else 1 end
             end;
    continue when v_as_of <= v_due;
    insert into public.agent_findings (tenant_id, agent_name, finding_type, severity, payload, reasoning, dedupe_key)
    values (r.tenant_id, 'file_monitor', 'missing_file', 'warning',
            jsonb_build_object('carrier_id', r.carrier_id, 'cadence', r.cadence, 'last_received_at', r.last_at, 'due', v_due),
            format('%s files %s; the last file arrived on %s, and none came by %s.', r.carrier_name,
                   case r.cadence when 'daily' then 'every business day' else r.cadence end,
                   to_char(r.last_at, 'FMMon FMDD, YYYY'), to_char(v_due, 'FMMon FMDD, YYYY')),
            'missing_file:' || r.carrier_id::text || ':' || v_due::text)
    on conflict (tenant_id, dedupe_key) do nothing;
    if found then v_missing := v_missing + 1; end if;
  end loop;

  -- 3. Every duplicate the doors skipped since yesterday, noted once.
  for r in
    select s.id, s.tenant_id, s.original_file_id, s.original_filename, s.source, s.skipped_at
      from public.file_registry_skips s
     where s.skipped_at >= (v_as_of - 1)::timestamptz
  loop
    insert into public.agent_findings (tenant_id, agent_name, file_id, finding_type, severity, payload, reasoning, status, dedupe_key)
    values (r.tenant_id, 'file_monitor', r.original_file_id, 'duplicate_file', 'info',
            jsonb_build_object('skip_id', r.id, 'source', r.source, 'skipped_at', r.skipped_at),
            format('"%s" arrived again by %s and was skipped: the same file is already held.', left(coalesce(r.original_filename, 'A file'), 200), r.source),
            'auto_resolved', 'duplicate_file:' || r.id::text)
    on conflict (tenant_id, dedupe_key) do nothing;
    if found then v_duplicates := v_duplicates + 1; end if;
  end loop;

  return jsonb_build_object('missing', v_missing, 'late', v_late, 'resolved', v_resolved, 'duplicates', v_duplicates);
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.pipeline_run enable row level security;
alter table public.pipeline_stage_run enable row level security;
drop policy if exists pipeline_run_read on public.pipeline_run;
create policy pipeline_run_read on public.pipeline_run for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists pipeline_stage_run_read on public.pipeline_stage_run;
create policy pipeline_stage_run_read on public.pipeline_stage_run for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.pipeline_run, public.pipeline_stage_run from public, anon, authenticated;
revoke delete, truncate on public.pipeline_run, public.pipeline_stage_run from service_role, tenant_app;
grant select, insert, update on public.pipeline_run, public.pipeline_stage_run to service_role;
grant select on public.pipeline_run, public.pipeline_stage_run to tenant_app;
revoke all on public.agent_accuracy_weekly from public, anon, authenticated;
grant select on public.agent_accuracy_weekly to service_role, tenant_app;
revoke all on function public.file_monitor_sweep(date) from public, anon, authenticated;
grant execute on function public.file_monitor_sweep(date) to service_role;

-- The agents' role: no login of its own; it reads what the agents watch and may only add findings.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'insurvas_agent') then
    create role insurvas_agent nologin noinherit;
  end if;
  -- So the check below (and the agent runtime, later) can take the role; it holds less than this one.
  execute format('grant insurvas_agent to %I', current_user);
end $$;
grant usage on schema public to insurvas_agent;
grant select on public.file_registry, public.raw_rows, public.policy_snapshot, public.policy_change, public.policy_current,
                public.commission_entry, public.expected_commission, public.carrier_operating_settings, public.policy_match_review,
                public.agent_findings, public.pipeline_run, public.pipeline_stage_run to insurvas_agent;
grant insert on public.agent_findings to insurvas_agent;
revoke insert, update, delete, truncate on public.raw_rows, public.commission_entry from insurvas_agent;
-- The agent role reads every agency's rows the way the service does (row security is the app's, per agency).
drop policy if exists agent_findings_agent_rw on public.agent_findings;
create policy agent_findings_agent_rw on public.agent_findings for all to insurvas_agent using (true) with check (true);
do $$
declare
  t text;
begin
  foreach t in array array['file_registry', 'raw_rows', 'policy_snapshot', 'policy_change', 'policy_current', 'commission_entry', 'expected_commission', 'carrier_operating_settings', 'policy_match_review', 'pipeline_run', 'pipeline_stage_run'] loop
    execute format('drop policy if exists %I on public.%I', t || '_agent_read', t);
    execute format('create policy %I on public.%I for select to insurvas_agent using (true)', t || '_agent_read', t);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-file-monitor-daily', '15 7 * * *', $cron$select public.file_monitor_sweep()$cron$);
    exception when others then
      raise notice '20261008280000: the daily file monitor could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- Run the monitor the way the job will, and prove the agent role cannot touch Layer 1 or the ledger.
do $$
declare
  v jsonb;
  v_update text := 'allowed';
  v_delete text := 'allowed';
  v_ledger text := 'allowed';
begin
  v := public.file_monitor_sweep();
  if v ? 'missing' is not true then
    raise exception '20261008280000: the file monitor did not report';
  end if;
  set local role insurvas_agent;
  begin update public.raw_rows set payload = payload where false; exception when insufficient_privilege then v_update := 'refused'; end;
  begin delete from public.raw_rows where false; exception when insufficient_privilege then v_delete := 'refused'; end;
  begin update public.commission_entry set amount_cents = amount_cents where false; exception when insufficient_privilege then v_ledger := 'refused'; end;
  reset role;
  if v_update <> 'refused' or v_delete <> 'refused' or v_ledger <> 'refused' then
    raise exception '20261008280000: the agent role must not change raw rows or the ledger (raw update %, raw delete %, ledger update %)', v_update, v_delete, v_ledger;
  end if;
  if has_table_privilege('insurvas_agent', 'public.commission_entry', 'DELETE') or has_table_privilege('insurvas_agent', 'public.raw_rows', 'INSERT') then
    raise exception '20261008280000: the agent role holds a write it must not';
  end if;
  if has_table_privilege('service_role', 'public.pipeline_stage_run', 'DELETE') then
    raise exception '20261008280000: a stage record is never deleted';
  end if;
end $$;
