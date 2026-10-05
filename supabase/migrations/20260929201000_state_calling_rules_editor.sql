-- ---------------------------------------------------------------------------
-- LA-2.4-2 / LA-2.4-3 · state calling rules the platform can maintain, and federal holidays the
-- state check actually reads
--
-- User decision, 2026-09-29: fix the bug where federal holidays are skipped by the state check,
-- then give super admins an editor for state calling hours, Sunday rules and state holidays, each
-- with an effective date and an audit trail. No legal data is entered here: the rows seeded by
-- 20260913340000 are left exactly as they are, and the compliance reviewer fills the rest in
-- through /admin/calling-rules.
--
-- 1. The bug. tenant_can_dial_now's state layer matched holidays with
--      h.state_code in ('*', upper(p_state))
--    but the federal calendar is stored with state_code NULL, and NULL is never IN anything. So a
--    state whose rule says "no calls on holidays" (every seeded row does) was dialled on
--    Thanksgiving. The state check now reads the federal rows too, and says which kind of holiday
--    refused the call (state_holiday or federal_holiday). tenant_dial_window, the dialer's
--    explainer, is restated with the same change and checked against it below.
--
-- 2. Minutes and a Sunday window. A statute such as "9am to 9pm, and noon to 9pm on Sunday" could
--    not be stored: the projection read whole hours and one window for every day. The table gains
--    sunday_start_local / sunday_end_local (both null = the weekday window applies on Sunday), and
--    the projection returns minutes, the Sunday window and the allowed weekdays. The hour columns
--    stay, rounded INWARD, for every reader that only knows hours.
--
-- 3. Effective dates that supersede. calling_window_rules_in_force returned every row in force, so
--    two rows for one state (the old statute and its replacement) both came back. It now returns
--    the latest effective_from on or before the date, one row per state. Publishing a rule closes
--    the one before it (effective_to), and only a rule that has not started yet may be withdrawn.
--
-- 4. The editor's writers: publish / withdraw a state rule, add / remove a holiday. Security
--    definer, service_role only — tenants still cannot write a statute, because a tenant that could
--    would widen its own window. Every write goes through /api/admin/calling-rules, which audits it.
--    The existing statement triggers (20260924230100) stamp the rules feed on every write.
-- ---------------------------------------------------------------------------

-- ── 2. the columns a real statute needs ─────────────────────────────────────
alter table public.calling_window_state_rules
  add column if not exists sunday_start_local time,
  add column if not exists sunday_end_local time,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.admin_users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calling_window_state_rules_sunday_window') then
    -- Both ends or neither, inside the federal 08:00-21:00, and start before end. Tighter only.
    alter table public.calling_window_state_rules
      add constraint calling_window_state_rules_sunday_window
      check ((sunday_start_local is null and sunday_end_local is null)
             or (sunday_start_local is not null and sunday_end_local is not null
                 and sunday_start_local >= time '08:00' and sunday_end_local <= time '21:00'
                 and sunday_start_local < sunday_end_local));
  end if;
end $$;

alter table public.calling_window_holidays
  add column if not exists source text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.admin_users(id) on delete set null;

-- ── 3. the rules in force, one per state ────────────────────────────────────
-- The return type grows, so the function is dropped and re-created. Its callers are PL/pgSQL
-- (tenant_can_dial_now, tenant_dial_window) and PostgREST, which bind by name at run time.
drop function if exists public.calling_window_rules_in_force(date);

create function public.calling_window_rules_in_force(p_on date default current_date)
returns table(
  state text,
  start_hour integer,
  end_hour integer,
  no_sunday boolean,
  no_holidays boolean,
  start_minute integer,
  end_minute integer,
  sunday_start_minute integer,
  sunday_end_minute integer,
  allowed_weekdays smallint[],
  effective_from date,
  source text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct on (r.state_code)
         r.state_code,
         -- Hours for the readers that only know hours, rounded INWARD: a start at 08:30 reads as
         -- 09, an end at 20:30 as 20, so an hour-only reader never sees a wider window.
         ceil((extract(hour from r.start_local) * 60 + extract(minute from r.start_local)) / 60.0)::integer,
         floor((extract(hour from r.end_local) * 60 + extract(minute from r.end_local)) / 60.0)::integer,
         -- 0 = Sunday. A rule that lists allowed weekdays and omits 0 forbids Sunday calls.
         (r.allowed_weekdays is not null and not (0 = any(r.allowed_weekdays))),
         coalesce(r.block_holidays, false),
         (extract(hour from r.start_local) * 60 + extract(minute from r.start_local))::integer,
         (extract(hour from r.end_local) * 60 + extract(minute from r.end_local))::integer,
         case when r.sunday_start_local is null then null
              else (extract(hour from r.sunday_start_local) * 60 + extract(minute from r.sunday_start_local))::integer end,
         case when r.sunday_end_local is null then null
              else (extract(hour from r.sunday_end_local) * 60 + extract(minute from r.sunday_end_local))::integer end,
         r.allowed_weekdays,
         r.effective_from,
         r.source
    from public.calling_window_state_rules r
   where r.effective_from <= p_on
     and (r.effective_to is null or r.effective_to > p_on)
   order by r.state_code, r.effective_from desc;
$function$;

revoke all on function public.calling_window_rules_in_force(date) from public, anon, authenticated;
grant execute on function public.calling_window_rules_in_force(date) to tenant_app, service_role;

-- ── 1. the dial check: federal holidays reach the state layer ───────────────
create or replace function public.tenant_can_dial_now(
  p_tenant_id uuid,
  p_state text,
  p_campaign_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
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

revoke all on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) to tenant_app, service_role;

-- ── the dialer's explainer, the same rules with a reason ────────────────────
create or replace function public.tenant_dial_window(
  p_tenant_id uuid,
  p_state text,
  p_campaign_id uuid,
  p_at timestamptz default now()
)
returns table(allowed boolean, start_minute integer, end_minute integer, zone text, local_minute integer, reason text)
language plpgsql
stable
security definer
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

revoke all on function public.tenant_dial_window(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_dial_window(uuid, text, uuid, timestamptz) to tenant_app, service_role;

-- ── 4. the editor's writers ─────────────────────────────────────────────────
-- Publish a state rule from a date. The rule before it is closed on that date, and a rule already
-- scheduled after it closes this one, so the table stays one row per state per day.
create or replace function public.publish_calling_window_state_rule(
  p_state text,
  p_effective_from date,
  p_start time,
  p_end time,
  p_allowed_weekdays smallint[],
  p_sunday_start time,
  p_sunday_end time,
  p_block_holidays boolean,
  p_source text,
  p_notes text,
  p_admin_id uuid
)
returns public.calling_window_state_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_next date;
  v_row public.calling_window_state_rules;
begin
  if not exists (select 1 from public.calling_window_state_timezones z where z.state_code = v_state) then
    raise exception 'CALLING_RULE_UNKNOWN_STATE';
  end if;
  if p_effective_from is null or p_effective_from < current_date then
    -- A rule cannot be backdated: that would rewrite which calls were legal when they were made.
    raise exception 'CALLING_RULE_BACKDATED';
  end if;
  if p_source is null or btrim(p_source) = '' then
    raise exception 'CALLING_RULE_SOURCE_REQUIRED';
  end if;
  if p_allowed_weekdays is null or cardinality(p_allowed_weekdays) = 0 then
    raise exception 'CALLING_RULE_NO_DAYS';
  end if;

  -- One writer per state at a time.
  perform 1 from public.calling_window_state_rules r where r.state_code = v_state for update;

  if exists (select 1 from public.calling_window_state_rules r where r.state_code = v_state and r.effective_from = p_effective_from) then
    raise exception 'CALLING_RULE_DATE_TAKEN';
  end if;

  select min(r.effective_from) into v_next
    from public.calling_window_state_rules r
   where r.state_code = v_state and r.effective_from > p_effective_from;

  -- The rule in force on that date ends where this one starts.
  update public.calling_window_state_rules r
     set effective_to = p_effective_from
   where r.state_code = v_state
     and r.effective_from < p_effective_from
     and (r.effective_to is null or r.effective_to > p_effective_from);

  insert into public.calling_window_state_rules
    (state_code, effective_from, effective_to, start_local, end_local, allowed_weekdays,
     sunday_start_local, sunday_end_local, block_holidays, source, notes, created_by)
  values
    (v_state, p_effective_from, v_next, p_start, p_end, p_allowed_weekdays,
     p_sunday_start, p_sunday_end, coalesce(p_block_holidays, true), left(btrim(p_source), 300),
     nullif(left(btrim(coalesce(p_notes, '')), 1000), ''), p_admin_id)
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.publish_calling_window_state_rule(text, date, time, time, smallint[], time, time, boolean, text, text, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.publish_calling_window_state_rule(text, date, time, time, smallint[], time, time, boolean, text, text, uuid)
  to service_role;

-- Withdraw a rule that has not started. A rule already in force is replaced by publishing a new
-- one, never deleted: its row is the record of what applied.
create or replace function public.withdraw_calling_window_state_rule(p_id uuid)
returns public.calling_window_state_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.calling_window_state_rules;
begin
  select * into v_row from public.calling_window_state_rules r where r.id = p_id for update;
  if not found then raise exception 'CALLING_RULE_NOT_FOUND'; end if;
  if v_row.effective_from <= current_date then raise exception 'CALLING_RULE_IN_FORCE'; end if;

  -- The rule before it runs on again, to wherever this one ran to.
  update public.calling_window_state_rules r
     set effective_to = v_row.effective_to
   where r.state_code = v_row.state_code
     and r.effective_to = v_row.effective_from;

  delete from public.calling_window_state_rules r where r.id = v_row.id;
  return v_row;
end;
$function$;

revoke all on function public.withdraw_calling_window_state_rule(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.withdraw_calling_window_state_rule(uuid) to service_role;

-- A holiday for one state, or for every state (state NULL: the federal calendar).
create or replace function public.add_calling_window_holiday(
  p_state text,
  p_date date,
  p_name text,
  p_source text,
  p_admin_id uuid
)
returns public.calling_window_holidays
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_row public.calling_window_holidays;
begin
  if v_state is not null and not exists (select 1 from public.calling_window_state_timezones z where z.state_code = v_state) then
    raise exception 'CALLING_RULE_UNKNOWN_STATE';
  end if;
  if p_date is null or p_date < current_date then raise exception 'CALLING_HOLIDAY_PAST'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'CALLING_HOLIDAY_NAME_REQUIRED'; end if;
  if exists (select 1 from public.calling_window_holidays h
              where h.holiday_date = p_date and h.state_code is not distinct from v_state) then
    raise exception 'CALLING_HOLIDAY_EXISTS';
  end if;
  insert into public.calling_window_holidays (state_code, holiday_date, name, blocked, source, created_by)
  values (v_state, p_date, left(btrim(p_name), 120), true, nullif(left(btrim(coalesce(p_source, '')), 300), ''), p_admin_id)
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.add_calling_window_holiday(text, date, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.add_calling_window_holiday(text, date, text, text, uuid) to service_role;

-- Remove a holiday that has not happened yet. A past one is the record of a day nobody was called.
create or replace function public.remove_calling_window_holiday(p_id uuid)
returns public.calling_window_holidays
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.calling_window_holidays;
begin
  select * into v_row from public.calling_window_holidays h where h.id = p_id for update;
  if not found then raise exception 'CALLING_HOLIDAY_NOT_FOUND'; end if;
  if v_row.holiday_date < current_date then raise exception 'CALLING_HOLIDAY_PAST'; end if;
  delete from public.calling_window_holidays h where h.id = v_row.id;
  return v_row;
end;
$function$;

revoke all on function public.remove_calling_window_holiday(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.remove_calling_window_holiday(uuid) to service_role;

-- The editor reads every version, not just the ones in force.
grant select on public.calling_window_state_rules, public.calling_window_holidays to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_count integer;
  v_tenant constant uuid := '00000000-0000-0000-0000-000000000000';
  v_day date := date '2099-01-05';                     -- a Monday, far past any real rule
  v_sunday date := date '2099-01-04';
  v_ny_noon timestamptz;
  v_tx_sun_10 timestamptz;
  v_tx_sun_13 timestamptz;
  v_tx_mon_0830 timestamptz;
  v_tx_mon_0930 timestamptz;
  v_rule public.calling_window_state_rules;
  v_reason text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929201000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- The seed is untouched: this file enters no legal data.
  select count(*) into v_count from public.calling_window_state_rules;
  if v_count < 52 then raise exception 'calling_window_state_rules lost rows (% left)', v_count; end if;
  select count(*) into v_count from public.calling_window_rules_in_force(current_date);
  if v_count <> (select count(distinct state_code) from public.calling_window_state_rules r
                  where r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)) then
    raise exception 'calling_window_rules_in_force does not return exactly one row per state';
  end if;
  if exists (select 1 from public.calling_window_rules_in_force(current_date) r
              where r.start_minute < 480 or r.end_minute > 1260 or r.start_hour < 8 or r.end_hour > 21) then
    raise exception 'a state rule in force is wider than the federal window';
  end if;

  -- Behaviour, built and rolled back: a federal holiday, a Sunday window, minutes, supersession.
  begin
    delete from public.calling_window_holidays where holiday_date in (v_day, v_sunday);
    insert into public.calling_window_holidays (state_code, holiday_date, name, blocked)
    values (null, v_day, '201000 probe federal holiday', true);

    -- NY: federal hours, holidays blocked. The federal row must now refuse the state check.
    v_rule := public.publish_calling_window_state_rule('NY', v_sunday, time '08:00', time '21:00',
                array[0,1,2,3,4,5,6]::smallint[], null, null, true, '201000 probe', null, null);
    v_ny_noon := (v_day + time '12:00') at time zone 'America/New_York';
    if public.tenant_can_dial_now(v_tenant, 'NY', null, v_ny_noon) then
      raise exception 'a federal holiday is still skipped by the state check (NY at noon on %)', v_day;
    end if;
    select w.reason into v_reason from public.tenant_dial_window(v_tenant, 'NY', null, v_ny_noon) w;
    if v_reason is distinct from 'federal_holiday' then
      raise exception 'the explainer calls the federal holiday %', v_reason;
    end if;

    -- A state rule that does not block holidays is still dialled on it.
    v_rule := public.publish_calling_window_state_rule('NY', v_day, time '08:00', time '21:00',
                array[0,1,2,3,4,5,6]::smallint[], null, null, false, '201000 probe', null, null);
    if not public.tenant_can_dial_now(v_tenant, 'NY', null, v_ny_noon) then
      raise exception 'a state rule with no holiday bar refused a federal holiday';
    end if;
    -- The Sunday rule was closed by the Monday one, not left open beside it.
    if (select count(*) from public.calling_window_rules_in_force(v_day) r where r.state = 'NY') <> 1 then
      raise exception 'two NY rules are in force on the same day';
    end if;
    if (select r.effective_to from public.calling_window_state_rules r where r.state_code = 'NY' and r.effective_from = v_sunday) is distinct from v_day then
      raise exception 'publishing a rule did not close the one before it';
    end if;

    -- TX-shaped: 09:00-21:00, and noon-21:00 on Sunday. Minutes and the Sunday window both bite.
    v_rule := public.publish_calling_window_state_rule('TX', v_sunday, time '09:00', time '21:00',
                array[0,1,2,3,4,5,6]::smallint[], time '12:00', time '21:00', false, '201000 probe', null, null);
    v_tx_sun_10 := (v_sunday + time '10:00') at time zone 'America/Chicago';
    v_tx_sun_13 := (v_sunday + time '13:00') at time zone 'America/Chicago';
    v_tx_mon_0830 := (v_day + time '08:30') at time zone 'America/Chicago';
    v_tx_mon_0930 := (v_day + time '09:30') at time zone 'America/Chicago';
    if public.tenant_can_dial_now(v_tenant, 'TX', null, v_tx_sun_10) then
      raise exception 'the Sunday window did not apply (TX 10:00 on a Sunday was dialable)';
    end if;
    if not public.tenant_can_dial_now(v_tenant, 'TX', null, v_tx_sun_13) then
      raise exception 'the Sunday window refused 13:00';
    end if;
    if public.tenant_can_dial_now(v_tenant, 'TX', null, v_tx_mon_0830) then
      raise exception 'a 09:00 state start still allowed 08:30';
    end if;
    if not public.tenant_can_dial_now(v_tenant, 'TX', null, v_tx_mon_0930) then
      raise exception 'a 09:00 state start refused 09:30';
    end if;

    -- Withdrawing the Monday NY rule re-opens the Sunday one to its old end.
    v_rule := public.withdraw_calling_window_state_rule(
      (select r.id from public.calling_window_state_rules r where r.state_code = 'NY' and r.effective_from = v_day));
    if (select r.effective_to from public.calling_window_state_rules r where r.state_code = 'NY' and r.effective_from = v_sunday) is not null then
      raise exception 'withdrawing a rule did not hand the dates back to the one before it';
    end if;

    -- A rule in force cannot be withdrawn, and a backdated one cannot be published.
    begin
      perform public.withdraw_calling_window_state_rule(
        (select r.id from public.calling_window_rules_in_force(current_date) f
           join public.calling_window_state_rules r on r.state_code = f.state and r.effective_from = f.effective_from
          limit 1));
      raise exception 'a rule in force was withdrawn';
    exception when raise_exception then
      if sqlerrm <> 'CALLING_RULE_IN_FORCE' then raise; end if;
    end;
    begin
      perform public.publish_calling_window_state_rule('NY', current_date - 1, time '08:00', time '21:00',
                array[1,2,3,4,5,6]::smallint[], null, null, true, '201000 probe', null, null);
      raise exception 'a backdated rule was published';
    exception when raise_exception then
      if sqlerrm <> 'CALLING_RULE_BACKDATED' then raise; end if;
    end;
    -- Wider than federal is refused by the table itself.
    begin
      perform public.publish_calling_window_state_rule('NY', v_day + 7, time '07:00', time '21:00',
                array[1,2,3,4,5,6]::smallint[], null, null, true, '201000 probe', null, null);
      raise exception 'a rule wider than federal was published';
    exception when check_violation then null;
    end;

    raise exception using errcode = 'P0099', message = '20260929201000 probe rollback';
  exception
    when sqlstate 'P0099' then null;
  end;

  -- Every state, eight days around Thanksgiving 2026, twice an hour: the explainer and the dial
  -- check must agree, holiday included.
  declare
    v_state text;
    v_hour integer;
    v_at timestamptz;
    v_explained boolean;
    v_decided boolean;
    v_base constant timestamptz := timestamptz '2026-11-22 00:00:00+00';
  begin
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
  end;

  if has_function_privilege('tenant_app', 'public.publish_calling_window_state_rule(text, date, time, time, smallint[], time, time, boolean, text, text, uuid)', 'execute') then
    raise exception 'tenant_app can publish a state calling rule';
  end if;
  if has_table_privilege('tenant_app', 'public.calling_window_state_rules', 'update') then
    raise exception 'tenant_app can write a state rule';
  end if;
  if not has_function_privilege('tenant_app', 'public.calling_window_rules_in_force(date)', 'execute') then
    raise exception 'tenant_app lost the rules projection';
  end if;
  raise notice '20260929201000: state rules editor in place, federal holidays reach the state check';
end $$;
