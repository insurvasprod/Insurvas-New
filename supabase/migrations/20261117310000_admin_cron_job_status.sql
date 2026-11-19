-- ---------------------------------------------------------------------------
-- The database's own scheduled jobs, readable by the admin dashboard (admin round 1, Platform health)
--
-- pg_cron records every run in cron.job_run_details, but nothing outside the database can read the
-- cron schema, so jobs like callback-due, assignment-rotation and the carrier-file poll fail silently
-- (they have: the callback-due job failed every minute for days, unseen). app_cron_status()
-- (20261015500000) already reports the /api/cron routes the database calls; this reports the rest.
--
--   admin_cron_job_status()   one row per pg_cron job: its schedule, whether it is active, its last
--                             start in the last 8 days with that run's status and message, and the
--                             last start that succeeded.
--
-- Read-only, no table, no data change. service_role only (the admin dashboard's server reads), never
-- tenant_app, anon or authenticated. Until this is applied the dashboard lists these jobs as
-- "not watched yet" (PGRST202 / 42883).
--
-- One pass over the last 8 days of run details (the cleanup jobs keep about 7), not a lookup per job.
--
-- Rollback: drop function if exists public.admin_cron_job_status();
-- ---------------------------------------------------------------------------

create or replace function public.admin_cron_job_status()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_start_at timestamptz,
  last_status text,
  last_message text,
  last_succeeded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- Without pg_cron there is nothing to report (and the cron schema does not exist to query).
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;
  return query execute $q$
    with recent as (
      select d.jobid, d.status, d.return_message, d.start_time
        from cron.job_run_details d
       where d.start_time > now() - interval '8 days'
    ),
    last_run as (
      select distinct on (r.jobid) r.jobid, r.start_time, r.status, r.return_message
        from recent r
       order by r.jobid, r.start_time desc
    ),
    last_ok as (
      select r.jobid, max(r.start_time) as start_time
        from recent r
       where r.status = 'succeeded'
       group by r.jobid
    )
    select j.jobname::text, j.schedule::text, j.active, l.start_time, l.status::text, left(l.return_message, 300), o.start_time
      from cron.job j
      left join last_run l on l.jobid = j.jobid
      left join last_ok o on o.jobid = j.jobid
     order by j.jobname
  $q$;
end;
$$;

revoke all on function public.admin_cron_job_status() from public, anon, authenticated, tenant_app;
grant execute on function public.admin_cron_job_status() to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('tenant_app', 'public.admin_cron_job_status()', 'EXECUTE') then
    raise exception '20261117310000: tenant_app must not read the cron job status';
  end if;
  if has_function_privilege('anon', 'public.admin_cron_job_status()', 'EXECUTE') then
    raise exception '20261117310000: anon must not read the cron job status';
  end if;
  -- The body must run: a function that only compiles is no proof it works.
  perform count(*) from public.admin_cron_job_status();
end $$;
