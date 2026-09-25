-- ---------------------------------------------------------------------------
-- Admin › Login activity: stats v2, and the indexes login_events was declared with.
--
-- 1. admin_login_activity_stats_v2() — the four figures of admin_login_activity_stats() plus
--    logins_last_week_to_date, the successful sign-ins from the start of LAST week up to this same
--    moment a week ago, so the "Logins this week" tile can compare like with like. A new name rather
--    than a replacement: v1's return type cannot change under `create or replace`, and the page
--    falls back to v1 until this file is applied.
--
--    Semantics are v1's as it is LIVE (probed 2026-09-24 with pg_get_functiondef: the
--    20260911141000 body, not the baseline dump's):
--      - logins_* count successful attempts of every actor, tenant users and staff alike;
--      - active_last_15_min counts distinct tenant USERS (user_id) only — staff are not counted.
--    Day and week boundaries are pinned to UTC with the three-argument date_trunc, so the figure
--    does not move with the session TimeZone; the page labels its times UTC.
--    The scan is bounded to the last two ISO weeks, so login_events_ts_idx serves it.
--
-- 2. login_events_ts_idx / _user_ts_idx / _admin_ts_idx — declared in 0000_baseline.sql but absent
--    from the live table (only login_events_pkey exists, probed 2026-09-24). Same names and
--    definitions as the baseline, `if not exists`, so a database that has them is untouched.
--
-- 3. login_events_email_trgm_idx — only where pg_trgm is installed (it is, in public, on the live
--    project). Serves the page's "Search actor, IP" box, which is an ilike '%term%' on email.
--
-- Read-only function, service_role only (the admin plane reads through the service client).
-- ---------------------------------------------------------------------------

create index if not exists login_events_ts_idx on public.login_events using btree (ts desc);
create index if not exists login_events_user_ts_idx on public.login_events using btree (user_id, ts desc);
create index if not exists login_events_admin_ts_idx on public.login_events using btree (admin_id, ts desc);

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  if v_schema is null then
    raise notice '20260924351000: pg_trgm is not installed, email search stays a sequential scan';
    return;
  end if;
  execute format(
    'create index if not exists login_events_email_trgm_idx on public.login_events using gin (email %I.gin_trgm_ops)',
    v_schema
  );
end;
$$;

create or replace function public.admin_login_activity_stats_v2()
returns table (
  logins_today integer,
  logins_this_week integer,
  logins_last_week_to_date integer,
  failed_today integer,
  active_last_15_min integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      date_trunc('day', now(), 'UTC') as day_start,
      date_trunc('week', now(), 'UTC') as week_start
  )
  select
    count(*) filter (where le.success and le.ts >= b.day_start)::integer,
    count(*) filter (where le.success and le.ts >= b.week_start)::integer,
    count(*) filter (
      where le.success and le.ts >= b.week_start - interval '7 days' and le.ts < now() - interval '7 days'
    )::integer,
    -- Failures matter on their own: a spike is the brute-force signal login protection acts on.
    count(*) filter (where not le.success and le.ts >= b.day_start)::integer,
    count(distinct le.user_id) filter (where le.success and le.ts > now() - interval '15 minutes')::integer
  from bounds b
  left join public.login_events le
    on le.ts >= b.week_start - interval '7 days';
$$;

comment on function public.admin_login_activity_stats_v2() is
  'Admin Login activity tiles: v1''s four figures (UTC day/week) plus successful sign-ins last week up to this moment a week ago. 20260924351000.';

revoke all on function public.admin_login_activity_stats_v2() from public, anon, authenticated, tenant_app;
grant execute on function public.admin_login_activity_stats_v2() to service_role;

do $$
declare
  v_row record;
begin
  -- Same guard as 20260924346000: a role without CREATE could not have applied anything above.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924351000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_login_activity_stats_v2()') is null then
    raise exception 'admin_login_activity_stats_v2 was not created';
  end if;
  if has_function_privilege('anon', 'public.admin_login_activity_stats_v2()', 'execute')
     or has_function_privilege('tenant_app', 'public.admin_login_activity_stats_v2()', 'execute') then
    raise exception 'admin_login_activity_stats_v2 must be service_role only';
  end if;
  if to_regclass('public.login_events_ts_idx') is null then
    raise exception 'login_events_ts_idx is missing';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_trgm')
     and to_regclass('public.login_events_email_trgm_idx') is null then
    raise exception 'pg_trgm is installed but login_events_email_trgm_idx was not created';
  end if;

  -- Exactly one row, even on an empty table (the left join keeps the bounds row).
  select * into strict v_row from public.admin_login_activity_stats_v2();
  if v_row.logins_today is null or v_row.logins_today > v_row.logins_this_week then
    raise exception 'admin_login_activity_stats_v2 returned inconsistent figures';
  end if;

  raise notice '20260924351000: admin_login_activity_stats_v2 and login_events indexes ready';
end;
$$;
