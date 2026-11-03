-- The app's scheduled jobs, run by the database (2026-10-15).
--
-- Every /api/cron/* route in the app needs something to call it on a schedule with CRON_SECRET.
-- vercel.json carried those schedules until it was emptied (57c6982, b37d0bf: the plan's cron limits),
-- and nothing replaced them — so period billing, trial reminders, the notification outbox and digests,
-- webhook delivery, SLA escalation and callback-reminder emails, DOI complaint deadlines, the monthly
-- compliance email, the retention dry-run summary and due consumer deletions (LA-6.5) never ran. This schedules them from pg_cron,
-- through pg_net, the way la4-carrier-file-poll already calls the app (20261008100000).
--
--   call_app_cron(path)   GET <app_base_url><path> with "Authorization: Bearer <cron_secret>";
--                         records the dispatch (app_cron_dispatch) with pg_net's request id.
--   app_cron_status()     per route: last dispatch, and the HTTP status pg_net got back — so a job
--                         that fails is visible (pg_cron jobs fail silently otherwise).
--
-- NEEDS two vault secrets, created once in the SQL editor (values never go in a migration):
--   select vault.create_secret('https://<the app''s production host>', 'app_base_url');   -- if absent
--   select vault.create_secret('<the app''s CRON_SECRET>', 'cron_secret');
-- Missing either, every job does nothing (and app_cron_status says why).
--
-- Jobs the database already runs itself are NOT duplicated here: assignment rotation, the unclaimed-SLA
-- ladder and its in-app side effects, in-app callback reminders, carrier-file polling.
--
-- Rollback:
--   select cron.unschedule(jobname) from cron.job where jobname like 'app-cron-%';
--   drop function if exists public.app_cron_status(); drop function if exists public.call_app_cron(text);
--   drop table if exists public.app_cron_dispatch;

create table if not exists public.app_cron_dispatch (
  id bigint generated always as identity primary key,
  path text not null,
  request_id bigint,
  skipped_reason text,
  dispatched_at timestamptz not null default now(),
  constraint app_cron_dispatch_path check (path ~ '^/api/cron/[a-z0-9-]+$')
);
create index if not exists app_cron_dispatch_path_idx on public.app_cron_dispatch (path, dispatched_at desc);
alter table public.app_cron_dispatch enable row level security;
revoke all on public.app_cron_dispatch from public, anon, authenticated, tenant_app;
grant select on public.app_cron_dispatch to service_role;
revoke insert, update, delete, truncate on public.app_cron_dispatch from service_role;

-- The routes this may call: nothing else, whatever a caller passes.
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
    '/api/cron/compliance-monthly', '/api/cron/retention-summary', '/api/cron/deletion-perform'
  ]::text[];
$$;

create or replace function public.call_app_cron(p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
  v_request bigint;
begin
  if not (p_path = any (public.app_cron_paths())) then
    raise exception 'call_app_cron: % is not a scheduled route', p_path using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    insert into public.app_cron_dispatch (path, skipped_reason) values (p_path, 'pg_net is not enabled');
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    insert into public.app_cron_dispatch (path, skipped_reason)
    values (p_path, case when v_url is null then 'vault secret app_base_url is missing' else 'vault secret cron_secret is missing' end);
    return;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 60000)'
    into v_request
    using rtrim(v_url, '/') || p_path, jsonb_build_object('Authorization', 'Bearer ' || v_secret);
  insert into public.app_cron_dispatch (path, request_id) values (p_path, v_request);
end;
$$;
revoke all on function public.call_app_cron(text) from public, anon, authenticated, tenant_app;
grant execute on function public.call_app_cron(text) to service_role;

-- Per route: the last dispatch and what came back (pg_net keeps responses for about six hours).
create or replace function public.app_cron_status()
returns table (path text, last_dispatched_at timestamptz, skipped_reason text, http_status integer, response_excerpt text, timed_out boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if to_regclass('net._http_response') is null then
    return query
      select p.path, d.dispatched_at, d.skipped_reason, null::integer, null::text, null::boolean
        from unnest(public.app_cron_paths()) as p(path)
        left join lateral (select * from public.app_cron_dispatch x where x.path = p.path order by x.dispatched_at desc limit 1) d on true;
    return;
  end if;
  return query execute $q$
    select p.path, d.dispatched_at, d.skipped_reason, r.status_code::integer, left(r.content, 300), r.timed_out
      from unnest(public.app_cron_paths()) as p(path)
      left join lateral (select * from public.app_cron_dispatch x where x.path = p.path order by x.dispatched_at desc limit 1) d on true
      left join net._http_response r on r.id = d.request_id
  $q$;
end;
$$;
revoke all on function public.app_cron_status() from public, anon, authenticated, tenant_app;
grant execute on function public.app_cron_status() to service_role;

-- The schedules (UTC). Every route is idempotent by its own keys, so a retry or overlap is harmless.
do $$
declare
  j record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20261015500000: pg_cron is not enabled; nothing scheduled.';
    return;
  end if;
  for j in
    select * from (values
      ('app-cron-period-billing',      '0 3 * * *',    '/api/cron/period-billing'),
      ('app-cron-invoices-overdue',    '30 3 * * *',   '/api/cron/invoices-overdue'),
      ('app-cron-metrics-daily',       '0 4 * * *',    '/api/cron/metrics-daily'),
      ('app-cron-trial-reminders',     '0 14 * * *',   '/api/cron/trial-reminders'),
      ('app-cron-notifications',       '*/5 * * * *',  '/api/cron/notifications'),
      ('app-cron-webhooks',            '* * * * *',    '/api/cron/webhooks'),
      ('app-cron-unclaimed-sla',       '* * * * *',    '/api/cron/unclaimed-sla'),
      ('app-cron-callback-reminders',  '*/5 * * * *',  '/api/cron/callback-reminders'),
      ('app-cron-calendar-busy',       '*/15 * * * *', '/api/cron/calendar-busy'),
      ('app-cron-licence-lapse',       '5 * * * *',    '/api/cron/licence-lapse'),
      ('app-cron-complaint-deadlines', '0 13 * * *',   '/api/cron/complaint-deadlines'),
      ('app-cron-compliance-monthly',  '0 14 * * *',   '/api/cron/compliance-monthly'),
      ('app-cron-retention-summary',   '0 5 * * *',    '/api/cron/retention-summary'),
      ('app-cron-deletion-perform',    '15 * * * *',   '/api/cron/deletion-perform')
    ) as t(name, schedule, path)
  loop
    begin
      perform cron.schedule(j.name, j.schedule, format('select public.call_app_cron(%L)', j.path));
    exception when others then
      raise notice '20261015500000: % could not be scheduled (%).', j.name, sqlerrm;
    end;
  end loop;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text := '';
  v_count integer;
begin
  -- A route outside the list is refused.
  begin
    perform public.call_app_cron('/api/cron/not-a-route');
    raise exception '20261015500000: an unlisted route was accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'call_app_cron:%' then raise; end if;
  end;
  if has_function_privilege('tenant_app', 'public.call_app_cron(text)', 'EXECUTE') then
    raise exception '20261015500000: tenant_app must not call the dispatcher';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into v_count from cron.job where jobname like 'app-cron-%';
    if v_count < 14 then
      raise exception '20261015500000: only % of 14 app jobs are scheduled', v_count;
    end if;
  end if;
  if not exists (select 1 from vault.secrets where name = 'app_base_url') then v_missing := v_missing || ' app_base_url'; end if;
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then v_missing := v_missing || ' cron_secret'; end if;
  if v_missing <> '' then
    raise notice '20261015500000: scheduled, but these vault secrets are missing, so every job will skip until they exist:%', v_missing;
  end if;
end $$;
