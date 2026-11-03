-- LA-3.26 / 3.21 — the two LA-3 jobs get a scheduler.
--
--   la3_expire_counteroffers()   REPLACED  as 20260926102210, plus: the attempt's other open
--                                          requirements are waived when the system closes it, the way
--                                          the app closes an attempt (lib/applications/requirements.ts
--                                          waiveOpenRequirements) — a closed attempt waits on nobody
--   la3-expire-counteroffers     PG_CRON   every 5 minutes: pending_client offers past expires_at →
--                                          expired, the attempt closed as offer_expired (STATUS-MODEL §4)
--   la3-refresh-sales-report     PG_CRON   hourly: la3_refresh_sales_report() (20260926101200). The
--                                          Sales performance page reads the base tables live
--                                          (lib/applications/report.ts); this keeps la3_sales_report()
--                                          from serving the snapshot taken when the views were created
--   la3-jobs-log-cleanup         PG_CRON   daily: pg_cron's run log for these two jobs kept 7 days
--
-- Side effects that live in the app are NOT done here and follow the next time the app touches the
-- case: the lead's pipeline card (lib/applications/stageSyncService.ts) moves on the next application
-- change or when someone opens the lead. The same split as the unclaimed-SLA ladder (20260924250100).
--
-- Scheduling under an existing job name replaces that job, so this file can be run again safely.
-- The check block runs both job bodies once and rolls them back (memory: pg_cron jobs fail silently —
-- a job whose body only compiles is not proof it runs).
--
-- To stop them:  select cron.unschedule('la3-expire-counteroffers'); select cron.unschedule('la3-refresh-sales-report');
-- To see runs:   select j.jobname, d.status, d.start_time, d.return_message from cron.job_run_details d
--                  join cron.job j using (jobid) where j.jobname like 'la3-%' order by d.start_time desc limit 12;
--
-- Down:
--   select cron.unschedule('la3-expire-counteroffers'); select cron.unschedule('la3-refresh-sales-report');
--   select cron.unschedule('la3-jobs-log-cleanup');
--   then re-run 20260926102210's create or replace of la3_expire_counteroffers().

create or replace function public.la3_expire_counteroffers()
returns table(counteroffer_id uuid, application_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  o record;
begin
  for o in
    select c.id, c.tenant_id, c.application_id, c.requirement_id
      from tenant_application_counteroffers c
      join tenant_applications a on a.id = c.application_id and a.tenant_id = c.tenant_id
     where c.status = 'pending_client'
       and c.expires_at is not null
       and c.expires_at < now()
       and a.status = 'counteroffer_pending'
     order by c.expires_at
     for update of c skip locked
  loop
    update tenant_application_counteroffers set status = 'expired' where id = o.id;
    if o.requirement_id is not null then
      update tenant_application_requirements set status = 'expired' where id = o.requirement_id and status in ('open', 'in_progress');
    end if;
    -- The system closes it: no actor, the outcome says why (STATUS-MODEL §3, offer_expired).
    perform public.application_transition(o.tenant_id, o.application_id, null, 'closed', 'offer_expired', null, null);
    -- A closed attempt is waiting on nobody: what else the carrier wanted from it is waived, as the app does.
    update tenant_application_requirements
       set status = 'waived', satisfied_at = current_date, note = 'Waived: the attempt was closed.'
     where tenant_id = o.tenant_id and application_id = o.application_id and status in ('open', 'in_progress');
    insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.application_transitioned', 'tenant_application', o.application_id::text,
            jsonb_build_object('tenantId', o.tenant_id, 'to', 'closed', 'outcome', 'offer_expired', 'counterofferId', o.id));
    counteroffer_id := o.id;
    application_id := o.application_id;
    return next;
  end loop;
end;
$function$;

revoke all on function public.la3_expire_counteroffers() from public, anon, authenticated;
grant execute on function public.la3_expire_counteroffers() to service_role;

-- LA-3 SCHEDULED JOBS v2 (2026-09-29). Supabase Cron is already installed (20260924250100 schedules
-- on it), so this file does not install the extension: on this project doing so fires Supabase's
-- pg_cron grant hook, which fails with 2BP01 "dependent privileges exist". 20260925708700 found the same.

select cron.schedule(
  'la3-expire-counteroffers',
  '*/5 * * * *',
  $cron$select count(*) from public.la3_expire_counteroffers()$cron$
);

select cron.schedule(
  'la3-refresh-sales-report',
  '7 * * * *',
  $cron$select public.la3_refresh_sales_report()$cron$
);

select cron.schedule(
  'la3-jobs-log-cleanup',
  '23 3 * * *',
  $cron$delete from cron.job_run_details
         where jobid in (select jobid from cron.job where jobname in ('la3-expire-counteroffers', 'la3-refresh-sales-report'))
           and end_time < now() - interval '7 days'$cron$
);

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'la3_expire_counteroffers' and p.prosecdef
       and p.prosrc like '%Waived: the attempt was closed.%'
  ) then
    raise exception '20260926103000: la3_expire_counteroffers does not waive the closed attempt''s requirements';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_expire_counteroffers()', 'execute') then
    raise exception '20260926103000: la3_expire_counteroffers is callable by tenant_app';
  end if;
  if position('delete' in lower((select prosrc from pg_proc where proname = 'la3_expire_counteroffers' limit 1))) > 0 then
    raise exception '20260926103000: la3_expire_counteroffers deletes something';
  end if;

  -- Run both job bodies once, then roll their work back: a body that fails here would fail every run.
  begin
    perform count(*) from public.la3_expire_counteroffers();
    perform public.la3_refresh_sales_report();
    raise exception using errcode = 'P0099', message = 'la3_jobs_probe_rollback';
  exception when sqlstate 'P0099' then
    null;
  end;

  if (select count(*) from cron.job
       where active
         and ((jobname = 'la3-expire-counteroffers' and schedule = '*/5 * * * *')
           or (jobname = 'la3-refresh-sales-report' and schedule = '7 * * * *')
           or (jobname = 'la3-jobs-log-cleanup' and schedule = '23 3 * * *'))) <> 3 then
    raise exception '20260926103000: an LA-3 job is not scheduled';
  end if;
end $$;
