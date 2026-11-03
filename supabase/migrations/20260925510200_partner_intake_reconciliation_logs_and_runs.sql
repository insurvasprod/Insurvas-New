-- LA-1.7-3: no partner lead exists without a work item or a logged failure.
--
-- QA 2026-09-25 (Design 1): public.reconcile_partner_intake() (20260902170000) only LISTED partner
-- leads with neither a lead_queue row nor an intake_failures row. Nothing scheduled it and nothing
-- acted on what it found; one such lead sat undetected in the demo tenant.
--
-- 1. run_partner_intake_reconciliation() logs one intake_failures row (step 'work_item') for each
--    lead the check returns. The existing trigger (create_intake_failure_alert) opens an
--    intake_alerts row for it, so the orphan shows on /app/alerts like any other intake failure.
--    A lead that has a failure row is no longer returned by the check, so a lead is logged once.
--    Leads younger than 10 minutes are skipped: intake writes the work item a moment after the lead,
--    and a run landing in between must not log a false failure.
-- 2. pg_cron runs it every 15 minutes (job 'partner-intake-reconciliation'), plus a daily trim of
--    that job's run log to 7 days. Scheduling under an existing job name replaces it, so this file
--    can run again safely.
--
-- To stop it:  select cron.unschedule('partner-intake-reconciliation');
-- To see runs: select status, start_time, return_message from cron.job_run_details
--              where jobid = (select jobid from cron.job where jobname = 'partner-intake-reconciliation')
--              order by start_time desc limit 10;

create or replace function public.run_partner_intake_reconciliation(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orphan record;
  v_logged integer := 0;
begin
  -- One run at a time, so two overlapping runs cannot log the same lead twice.
  perform pg_advisory_xact_lock(hashtextextended('run_partner_intake_reconciliation', 0));
  for v_orphan in
    select r.lead_id as orphan_lead_id, r.tenant_id as orphan_tenant_id, r.submission_id as orphan_submission_id, r.missing_steps as orphan_steps
      from public.reconcile_partner_intake() r
      join public.agent_leads l on l.id = r.lead_id
     where l.created_at < now() - interval '10 minutes'
     order by l.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  loop
    insert into public.intake_failures (tenant_id, lead_id, step, error_message, metadata)
    values (
      v_orphan.orphan_tenant_id,
      v_orphan.orphan_lead_id,
      'work_item',
      'Reconciliation found this partner lead without a work item or a logged failure.',
      jsonb_build_object(
        'source', 'reconcile_partner_intake',
        'submission_id', v_orphan.orphan_submission_id,
        'missing_steps', to_jsonb(v_orphan.orphan_steps)
      )
    );
    v_logged := v_logged + 1;
  end loop;
  return v_logged;
end;
$$;

revoke all on function public.run_partner_intake_reconciliation(integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_partner_intake_reconciliation(integer) to service_role;

-- Supabase Cron is installed and granted by 20260924250100 (applied 2026-09-24).
select cron.schedule(
  'partner-intake-reconciliation',
  '*/15 * * * *',
  $cron$select public.run_partner_intake_reconciliation(500)$cron$
);

select cron.schedule(
  'partner-intake-reconciliation-log-cleanup',
  '41 3 * * *',
  $cron$delete from cron.job_run_details
         where jobid in (select jobid from cron.job where jobname = 'partner-intake-reconciliation')
           and end_time < now() - interval '7 days'$cron$
);

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.run_partner_intake_reconciliation(integer)') is null then
    raise exception 'run_partner_intake_reconciliation is missing';
  end if;
  -- Run the job's function once and roll it back (a PL/pgSQL body only resolves names when it runs;
  -- see 20260925709100). Then prove the effect: after a run, no lead older than the grace period is
  -- left without a work item or a failure row.
  begin
    perform public.run_partner_intake_reconciliation(5000);
    if exists (
      select 1 from public.reconcile_partner_intake() r
        join public.agent_leads l on l.id = r.lead_id
       where l.created_at < now() - interval '10 minutes'
    ) then
      raise exception 'reconciliation left a partner lead without a work item or a logged failure';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not exists (select 1 from cron.job where jobname = 'partner-intake-reconciliation' and schedule = '*/15 * * * *' and active) then
    raise exception 'the partner intake reconciliation is not scheduled';
  end if;
end $$;
