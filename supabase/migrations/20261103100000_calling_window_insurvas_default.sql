-- Settings defaults · calling windows (docs/settings/DEFAULTS.md, owner pick 2026-11-03).
--
-- An agency with no calling-window row of its own now dials inside the Insurvas default instead of
-- the bare federal floor: 9:00 am–8:00 pm in the customer's zone, no Sundays, no federal holidays.
-- Narrowing only, like every layer: the state rules still apply on top, and an agency that saves its
-- own hours or switches keeps them (3 agencies have hours, 2 have switches, as of 2026-11-03).
--
-- IMPACT: the other ~608 agencies narrow from 8–9 to 9–8 and stop dialing on Sundays and federal
-- holidays the moment this is applied. Telephony is not live yet, so nothing is spoken to anyone.
--
-- NOT LEGAL ADVICE. These hours are a conservative starting point; the owner or counsel must review
-- them. The Settings page marks them "Needs legal review".
--
-- Restated from the live bodies of tenant_can_dial_now and its explainer tenant_dial_window
-- (pg_get_functiondef, read 2026-11-03, identical
-- to 20260929201000); the only change is the two `else` branches. The guard below refuses to replace
-- a body that has moved on since.
--
-- TS twin: INSURVAS_DEFAULT_WINDOW / INSURVAS_DEFAULT_OPTIONS in lib/callingWindow/engine.ts. The
-- Settings page treats this function's presence as "the default is live".

begin;

create or replace function public.calling_window_insurvas_default()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'start_minute', 540,
    'end_minute', 1200,
    'no_sunday', true,
    'no_federal_holidays', true,
    'campaign_overrides_enabled', true
  );
$$;

comment on function public.calling_window_insurvas_default() is
  'The Insurvas default calling window for an agency with no row of its own (docs/settings/DEFAULTS.md). Needs owner/counsel review.';

revoke all on function public.calling_window_insurvas_default() from public;
grant execute on function public.calling_window_insurvas_default() to authenticated, service_role;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure) into v_def;
  v_def := replace(v_def, E'\r\n', E'\n');
  if v_def not like '%[201000] Minutes, and the state''s own Sunday window%'
     or v_def not like '%v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);%'
     or v_def like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_can_dial_now is not the 20260929201000 body; re-read it before restating';
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

-- ── the explainer, which must agree with the decision ───────────────────────
-- tenant_dial_window says WHY a dial is refused (the dialer and Calling windows read it). Restated
-- from its live body (read 2026-11-03, identical to 20260929201000) with the same two `else` branches.
do $$
declare
  v_def text;
begin
  select replace(pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure), E'\r\n', E'\n') into v_def;
  if v_def not like '%Checked with the same predicate as tenant_can_dial_now.%'
     or v_def like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_dial_window is not the 20260929201000 body; re-read it before restating';
  end if;
end $$;

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

-- ── check ────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.tenant_can_dial_now(uuid,text,uuid,timestamp with time zone)'::regprocedure);
  -- An agency with no rows at all: the Insurvas default is what both functions apply.
  v_tenant uuid := gen_random_uuid();
  v_state text;
  v_hour integer;
  v_at timestamptz;
  v_explained boolean;
  v_decided boolean;
  v_base constant timestamptz := timestamptz '2026-11-22 00:00:00+00';
begin
  if v_def not like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_can_dial_now does not read the Insurvas default';
  end if;
  if pg_get_functiondef('public.tenant_dial_window(uuid,text,uuid,timestamp with time zone)'::regprocedure) not like '%calling_window_insurvas_default%' then
    raise exception '20261103100000: tenant_dial_window does not read the Insurvas default';
  end if;
  -- Every state, eight days around Thanksgiving 2026 (a Sunday and a federal holiday inside),
  -- twice an hour: the explainer and the dial check must agree on the default too.
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
  -- The default bites: 8:30 am in New York on a Monday is inside federal hours but outside 9–8.
  if public.tenant_can_dial_now(v_tenant, 'NY', null, (date '2026-11-23' + time '08:30') at time zone 'America/New_York') then
    raise exception '20261103100000: the default did not narrow the morning';
  end if;
  if (public.calling_window_insurvas_default() ->> 'start_minute')::integer <> 540
     or (public.calling_window_insurvas_default() ->> 'end_minute')::integer <> 1200 then
    raise exception '20261103100000: the Insurvas default is not 9:00–20:00';
  end if;
end $$;

commit;
