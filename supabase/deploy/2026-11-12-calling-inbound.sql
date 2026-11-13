-- ============================================================================
-- Calling windows, settings round 8 — 1 file, in its own transaction
-- Written 2026-11-12 for supabase/migrations/20261112300000_calling_inbound_r8.sql. Keep the two in step.
--
-- HOW TO RUN: Supabase dashboard -> SQL editor -> paste this whole file -> Run.
-- It is begin ... commit: on an error nothing is applied. The guard refuses to run when
-- tenant_can_dial_now / tenant_dial_window are not the 20261103100000 bodies (or this file already ran).
--
-- WHAT WAITS ON IT (Settings > Calling windows says "needs a database update" until then):
--   different hours per weekday on the week grid (until then every open day keeps the same hours and
--   only Sunday can be off, by the No Sundays switch), and the agency's own days off (a closed day or
--   an afternoon) in the Days off sheet.
--
-- Inbound settings needs nothing here: it is built on today's tables.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
-- ============================================================================

-- --- [1/1] 20261112300000_calling_inbound_r8.sql ------------------------------
-- Settings round 8 · Calling windows (owner: "Build all four", 2026-11-12, board calling-and-inbound).
--
-- The screen draws the agency's hours as a week you drag, a block per weekday, and lists the
-- agency's own days off (an afternoon, a closed day) under the federal holidays. Two things the
-- database could not hold:
--
--   1. A DAY OF ITS OWN. `tenant_calling_window_days`, one row per weekday that differs from the
--      agency's base hours: `closed` (no dialing that weekday) or narrower minutes. The app always
--      stores the base window (`tenant_calling_windows`) as the envelope of the open days, so the base
--      narrowed by a day's row is exactly that day, and every reader that only knows the base still
--      sees a window no narrower than the real one on any day it dials. No row = the base hours.
--
--   2. THE AGENCY'S OWN DAYS OFF. `tenant_calling_days_off`, a calendar date in the customer's zone:
--      `from_minute` null = the whole day, else nothing from that minute on (Christmas Eve from 1 pm).
--
-- Both are NARROWING ONLY, like every layer: a day's row is greatest(start)/least(end) on top of the
-- base, an afternoon off is least(end). Nothing here can widen a window.
--
-- tenant_can_dial_now and its explainer tenant_dial_window are restated from 20261103100000 (the live
-- bodies; the guard below refuses to replace a body that has moved on) with two blocks added after
-- the agency's base hours, marked [20261112300000]. The explainer reuses the reasons the dialer
-- already words (lib/dialerScripts/display.ts): a closed weekday or a whole day off is 'no_window',
-- an afternoon off reads as 'after_close'.
--
-- Cost: two primary-key / unique-index lookups per call. Until this is applied the Settings page says
-- "needs a database update", keeps every open day on the same hours, and offers no own days off.

begin;

-- ── 1. a day of its own ─────────────────────────────────────────────────────
create table if not exists public.tenant_calling_window_days (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday smallint not null,
  closed boolean not null default false,
  start_minute integer,
  end_minute integer,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, weekday),
  constraint tenant_calling_window_days_weekday check (weekday between 0 and 6),
  constraint tenant_calling_window_days_sane check (
    closed
    or (start_minute between 0 and 1439 and end_minute between 1 and 1440 and start_minute < end_minute)
  )
);

comment on table public.tenant_calling_window_days is
  'Settings › Calling windows: a weekday that differs from the agency''s base hours (closed, or narrower). Narrowing only; read by tenant_can_dial_now.';

alter table public.tenant_calling_window_days enable row level security;
drop policy if exists tenant_calling_window_days_tenant_scoped on public.tenant_calling_window_days;
create policy tenant_calling_window_days_tenant_scoped on public.tenant_calling_window_days
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_calling_window_days from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_calling_window_days to tenant_app;
grant select, insert, update, delete on public.tenant_calling_window_days to service_role;

-- ── 2. the agency's own days off ────────────────────────────────────────────
create table if not exists public.tenant_calling_days_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  from_minute integer,
  label text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  constraint tenant_calling_days_off_one_per_day unique (tenant_id, day),
  constraint tenant_calling_days_off_from check (from_minute is null or from_minute between 0 and 1439),
  constraint tenant_calling_days_off_label check (char_length(label) <= 80)
);

comment on table public.tenant_calling_days_off is
  'Settings › Calling windows: the agency''s own days off, in the customer''s zone. from_minute null = all day. Narrowing only; read by tenant_can_dial_now.';

alter table public.tenant_calling_days_off enable row level security;
drop policy if exists tenant_calling_days_off_tenant_scoped on public.tenant_calling_days_off;
create policy tenant_calling_days_off_tenant_scoped on public.tenant_calling_days_off
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_calling_days_off from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_calling_days_off to tenant_app;
grant select, insert, update, delete on public.tenant_calling_days_off to service_role;

-- ── 3. the dial check ───────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%[20261103100000] No hours of its own: the Insurvas default hours.%'
     or v_def like '%[20261112300000]%' then
    raise exception '20261112300000: tenant_can_dial_now is not the 20261103100000 body; re-read it before restating';
  end if;
  select replace(pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%[20261103100000] No hours of its own: the Insurvas default hours.%'
     or v_def like '%[20261112300000]%' then
    raise exception '20261112300000: tenant_dial_window is not the 20261103100000 body; re-read it before restating';
  end if;
end $$;

create or replace function public.tenant_can_dial_now(p_tenant_id uuid, p_state text, p_campaign_id uuid, p_at timestamp with time zone default now())
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_zone text;
  -- The customer's wall clock: `p_at at time zone v_zone` is a local timestamp.
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;   -- federal floor, in minutes of the customer's day
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_day record;
  v_off record;
  v_campaigns_apply boolean := true;
  -- [20261103100000] The Insurvas default, for an agency with no row of its own.
  v_default jsonb := public.calling_window_insurvas_default();
begin
  -- A lead with no state has no timezone and is not dialable. Absence of data is not permission.
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then return false; end if;

  -- A stale rules feed refuses the dial rather than guessing. Checked against now(), not p_at: the
  -- question is whether the rules can be trusted today, whatever instant is being asked about.
  if public.calling_window_rules_stale(now()) then return false; end if;

  select timezone into v_zone from public.state_timezones where state = upper(p_state);
  if v_zone is null then return false; end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  -- Each layer may only narrow. max(start), min(end) is the only operation, so a row that tries to
  -- widen is a no-op rather than a privilege escalation.
  select * into v_rule from public.calling_window_rules_in_force(v_local::date) r
   where r.state = upper(p_state);
  if found then
    -- [201000] Minutes, and the state's own Sunday window when it has one.
    if v_dow = 0 and v_rule.sunday_start_minute is not null then
      v_start := greatest(v_start, v_rule.sunday_start_minute);
      v_end := least(v_end, v_rule.sunday_end_minute);
    else
      v_start := greatest(v_start, coalesce(v_rule.start_minute, v_rule.start_hour * 60));
      v_end := least(v_end, coalesce(v_rule.end_minute, v_rule.end_hour * 60));
    end if;
    if v_rule.no_sunday and v_dow = 0 then return false; end if;
    if v_rule.allowed_weekdays is not null and not (v_dow::smallint = any(v_rule.allowed_weekdays)) then return false; end if;
    -- [201000] The state's own holidays AND the federal calendar (state_code NULL). NULL is never
    -- IN a list, so the federal rows used to be skipped here.
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code in ('*', upper(p_state)))
    ) then return false; end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows where tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  else
    -- [20261103100000] No hours of its own: the Insurvas default hours.
    v_start := greatest(v_start, (v_default ->> 'start_minute')::integer);
    v_end := least(v_end, (v_default ->> 'end_minute')::integer);
  end if;

  -- [20261112300000] The agency's own week: a weekday off, or a weekday narrower than its base hours.
  select d.closed, d.start_minute, d.end_minute into v_day
    from public.tenant_calling_window_days d
   where d.tenant_id = p_tenant_id and d.weekday = v_dow;
  if found then
    if v_day.closed then return false; end if;
    v_start := greatest(v_start, v_day.start_minute);
    v_end := least(v_end, v_day.end_minute);
  end if;

  -- [20261112300000] The agency's own days off: the whole day, or nothing from a time onwards.
  select o.from_minute into v_off
    from public.tenant_calling_days_off o
   where o.tenant_id = p_tenant_id and o.day = v_local::date;
  if found then
    if v_off.from_minute is null then return false; end if;
    v_end := least(v_end, v_off.from_minute);
  end if;

  select * into v_options from public.tenant_calling_window_options where tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then return false; end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then return false; end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  else
    -- [20261103100000] No switches of its own: the Insurvas default switches.
    if (v_default ->> 'no_sunday')::boolean and v_dow = 0 then return false; end if;
    if (v_default ->> 'no_federal_holidays')::boolean and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then return false; end if;
    v_campaigns_apply := coalesce((v_default ->> 'campaign_overrides_enabled')::boolean, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(calling_window_start_minute, calling_window_start_hour * 60) as s,
           coalesce(calling_window_end_minute, calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then return false; end if;
  return v_minute >= v_start and v_minute < v_end;
end;
$function$;

-- ── 4. the explainer, which must agree with the decision ────────────────────
create or replace function public.tenant_dial_window(p_tenant_id uuid, p_state text, p_campaign_id uuid, p_at timestamp with time zone default now())
 returns table(allowed boolean, start_minute integer, end_minute integer, zone text, local_minute integer, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_zone text;
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_day record;
  v_off record;
  v_campaigns_apply boolean := true;
  v_holiday_federal boolean;
  -- [20261103100000] The Insurvas default, for an agency with no row of its own.
  v_default jsonb := public.calling_window_insurvas_default();
begin
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_state'::text;
    return;
  end if;

  if public.calling_window_rules_stale(now()) then
    return query select false, null::integer, null::integer, null::text, null::integer, 'rules_stale'::text;
    return;
  end if;

  select st.timezone into v_zone from public.state_timezones st where st.state = upper(p_state);
  if v_zone is null then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_zone'::text;
    return;
  end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  select * into v_rule from public.calling_window_rules_in_force(v_local::date) r
   where r.state = upper(p_state);
  if found then
    if v_dow = 0 and v_rule.sunday_start_minute is not null then
      v_start := greatest(v_start, v_rule.sunday_start_minute);
      v_end := least(v_end, v_rule.sunday_end_minute);
    else
      v_start := greatest(v_start, coalesce(v_rule.start_minute, v_rule.start_hour * 60));
      v_end := least(v_end, coalesce(v_rule.end_minute, v_rule.end_hour * 60));
    end if;
    if v_rule.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'state_no_sunday'::text;
      return;
    end if;
    if v_rule.allowed_weekdays is not null and not (v_dow::smallint = any(v_rule.allowed_weekdays)) then
      return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
      return;
    end if;
    -- A federal date is named as one: 'federal_holiday' reads better than "a state holiday" on
    -- Thanksgiving. Checked with the same predicate as tenant_can_dial_now.
    select bool_or(h.state_code is null or h.state_code = '*') into v_holiday_federal
      from public.calling_window_holidays h
     where h.holiday_date = v_local::date
       and h.blocked
       and (h.state_code is null or h.state_code in ('*', upper(p_state)));
    if v_rule.no_holidays and v_holiday_federal is not null then
      return query select false, v_start, v_end, v_zone, v_minute,
        (case when v_holiday_federal then 'federal_holiday' else 'state_holiday' end)::text;
      return;
    end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows w where w.tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  else
    -- [20261103100000] No hours of its own: the Insurvas default hours.
    v_start := greatest(v_start, (v_default ->> 'start_minute')::integer);
    v_end := least(v_end, (v_default ->> 'end_minute')::integer);
  end if;

  -- [20261112300000] The agency's own week: a weekday off reads as no window today.
  select d.closed, d.start_minute, d.end_minute into v_day
    from public.tenant_calling_window_days d
   where d.tenant_id = p_tenant_id and d.weekday = v_dow;
  if found then
    if v_day.closed then
      return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
      return;
    end if;
    v_start := greatest(v_start, v_day.start_minute);
    v_end := least(v_end, v_day.end_minute);
  end if;

  -- [20261112300000] The agency's own days off: all day is no window; an afternoon closes early.
  select o.from_minute into v_off
    from public.tenant_calling_days_off o
   where o.tenant_id = p_tenant_id and o.day = v_local::date;
  if found then
    if v_off.from_minute is null then
      return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
      return;
    end if;
    v_end := least(v_end, v_off.from_minute);
  end if;

  select * into v_options from public.tenant_calling_window_options o where o.tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'agency_no_sunday'::text;
      return;
    end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'federal_holiday'::text;
      return;
    end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  else
    -- [20261103100000] No switches of its own: the Insurvas default switches.
    if (v_default ->> 'no_sunday')::boolean and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'agency_no_sunday'::text;
      return;
    end if;
    if (v_default ->> 'no_federal_holidays')::boolean and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.blocked
         and (h.state_code is null or h.state_code = '*')
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'federal_holiday'::text;
      return;
    end if;
    v_campaigns_apply := coalesce((v_default ->> 'campaign_overrides_enabled')::boolean, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(c.calling_window_start_minute, c.calling_window_start_hour * 60) as s,
           coalesce(c.calling_window_end_minute, c.calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns c
     where c.id = p_campaign_id and c.tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
    return;
  end if;
  if v_minute < v_start then
    return query select false, v_start, v_end, v_zone, v_minute, 'before_open'::text;
    return;
  end if;
  if v_minute >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'after_close'::text;
    return;
  end if;
  return query select true, v_start, v_end, v_zone, v_minute, 'open'::text;
end;
$function$;

-- ── 5. check ─────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_state text;
  v_hour integer;
  v_at timestamptz;
  v_explained boolean;
  v_decided boolean;
  v_base constant timestamptz := timestamptz '2026-11-22 00:00:00+00';
begin
  if pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure) not like '%tenant_calling_window_days%'
     or pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure) not like '%tenant_calling_days_off%' then
    raise exception '20261112300000: tenant_can_dial_now does not read the week and the days off';
  end if;
  if pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure) not like '%tenant_calling_window_days%' then
    raise exception '20261112300000: tenant_dial_window does not read the week';
  end if;
  -- Every state, eight days around Thanksgiving 2026, twice an hour: the explainer and the dial
  -- check still agree for an agency with no rows (the Insurvas default, unchanged by this file).
  for v_state in select st.state from public.state_timezones st union all select 'XX' loop
    for v_hour in 0 .. (8 * 24 - 1) loop
      foreach v_at in array array[v_base + make_interval(hours => v_hour), v_base + make_interval(hours => v_hour, mins => 45)] loop
        select w.allowed into v_explained from public.tenant_dial_window(v_tenant, v_state, null, v_at) w;
        v_decided := public.tenant_can_dial_now(v_tenant, v_state, null, v_at);
        if v_explained is distinct from coalesce(v_decided, false) then
          raise exception 'tenant_dial_window disagrees with tenant_can_dial_now for state % at %: % vs %',
            v_state, v_at, v_explained, v_decided;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

commit;
