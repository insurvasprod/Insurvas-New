-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · an agent with no working hours cannot be booked
--
-- `book_appointment` checked working hours and blocked time only when the agent had availability
-- rows: the zone came from the first of them, and `if v_zone is not null then ... end if` skipped
-- both checks when there were none. So an agent who had never set their hours could be booked at
-- any time inside the customer's calling window — exactly the "time that does not exist" the
-- calendar says cannot be typed. The pickers never offered such an agent (their list is built from
-- availability), but the API took the booking.
--
-- USER DECISION 2026-09-25: refuse it, with its own code, APPOINTMENT_AGENT_HAS_NO_HOURS.
-- Appointments already on the books are untouched: this is a booking rule, not a sweep.
--
-- `reschedule_appointment` and `rebook_appointment` (20260925704200) both book through this
-- function, so they refuse the same way.
--
-- Reproduced from 20260924230200 (its latest definition); every rule is kept in the same order with
-- the same exception names. The one addition is marked [704000].
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_agent_user_id uuid,
  p_booked_by uuid,
  p_starts_at_utc timestamptz,
  p_notes text default null,
  p_duration_minutes integer default null
)
returns table(appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy record;
  v_minutes integer;
  v_buffer integer;
  v_zone text;
  v_state text;
  v_campaign uuid;
  v_customer_zone text;
  v_local timestamp;
  v_dow smallint;
  v_id uuid;
  v_booked_that_day integer;
  v_range tstzrange;
  v_agency_cap integer;
  v_agency_zone text;
  v_agency_day date;
  v_seat smallint := 1;
begin
  if p_starts_at_utc <= now() then
    raise exception 'APPOINTMENT_IN_THE_PAST';
  end if;

  -- [704000] Nobody can be booked who has no working hours. Checked before anything else about
  -- the agent, because every later rule (hours, blocks, same-day, the per-agent cap) is read in
  -- the zone those hours carry.
  if not exists (
    select 1 from tenant_agent_availability av
     where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id
  ) then
    raise exception 'APPOINTMENT_AGENT_HAS_NO_HOURS';
  end if;

  select * into v_policy from tenant_agent_booking_policy
   where tenant_id = p_tenant_id and user_id = p_agent_user_id;
  v_minutes := coalesce(p_duration_minutes, v_policy.appointment_minutes, 30);
  v_buffer := coalesce(v_policy.buffer_minutes, 0);
  v_range := tstzrange(p_starts_at_utc, p_starts_at_utc + make_interval(mins => v_minutes), '[)');

  select l.values->>'state', l.campaign_id into v_state, v_campaign
    from agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if v_state is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  select timezone into v_customer_zone from state_timezones where state = upper(v_state);
  if v_customer_zone is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  -- [added] A stale state-rules feed refuses every dial (20260924230100), and an appointment is a
  -- call. Said as itself rather than as "outside the customer's window".
  if public.calling_window_rules_stale(now()) then
    raise exception 'APPOINTMENT_CALLING_RULES_STALE';
  end if;

  -- The customer's legal window, at the booked instant. An appointment is a call, and an
  -- appointment at 3am is a call at 3am that our own system put in the diary.
  if not tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_starts_at_utc) then
    raise exception 'APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW';
  end if;

  -- The agent's own working hours, in the agent's zone.
  select av.timezone into v_zone from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id limit 1;

  -- Same-day booking, in the agent's own day. On by default, which is how booking always behaved.
  if coalesce(v_policy.allow_same_day, true) = false
     and (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
         = (now() at time zone coalesce(v_zone, 'UTC'))::date then
    raise exception 'APPOINTMENT_SAME_DAY_NOT_ALLOWED';
  end if;

  if v_zone is not null then
    v_local := p_starts_at_utc at time zone v_zone;
    v_dow := extract(dow from v_local)::smallint;

    if not exists (
      select 1 from tenant_agent_availability av
       where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id
         and av.weekday = v_dow
         and v_local::time >= av.start_time
         and (v_local + make_interval(mins => v_minutes))::time <= av.end_time
    ) then
      raise exception 'APPOINTMENT_OUTSIDE_AVAILABILITY';
    end if;

    -- One-off blocks: the stored instant, exactly as before.
    if exists (
      select 1 from tenant_agent_blocks b
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') = 'none'
         and tstzrange(b.starts_at, b.ends_at, '[)') && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;

    -- Repeating blocks: every occurrence whose day could reach the requested range.
    if exists (
      select 1
        from tenant_agent_blocks b
        cross join lateral generate_series(
          ((p_starts_at_utc at time zone v_zone)::date
            - ceil(extract(epoch from (b.ends_at - b.starts_at)) / 86400.0)::integer)::timestamp,
          ((p_starts_at_utc + make_interval(mins => v_minutes)) at time zone v_zone)::date::timestamp,
          interval '1 day'
        ) as g(d)
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') <> 'none'
         and g.d::date >= (b.starts_at at time zone v_zone)::date
         and case b.repeats
               when 'daily' then true
               when 'weekdays' then extract(isodow from g.d) between 1 and 5
               when 'weekly' then extract(dow from g.d) = extract(dow from (b.starts_at at time zone v_zone))
               when 'yearly' then to_char(g.d, 'MM-DD') = to_char(b.starts_at at time zone v_zone, 'MM-DD')
               else false
             end
         and tstzrange(
               (g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone,
               ((g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone) + (b.ends_at - b.starts_at),
               '[)'
             ) && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;
  end if;

  -- [added] Busy time in a connected Google or Outlook calendar, when the agent honours it. Only a
  -- CONNECTED calendar counts: a pending or failed connection has no trustworthy busy set.
  if coalesce(v_policy.honour_linked_calendars, true) and exists (
    select 1
      from tenant_calendar_busy cb
      join tenant_connected_calendars cc on cc.id = cb.calendar_id and cc.status = 'connected'
     where cb.tenant_id = p_tenant_id and cb.user_id = p_agent_user_id
       and cb.ends_at > p_starts_at_utc
       and tstzrange(cb.starts_at, cb.ends_at, '[)') && v_range
  ) then
    raise exception 'APPOINTMENT_LINKED_CALENDAR_BUSY';
  end if;

  -- The daily cap, server-side. Counted in the AGENT's day, not UTC's: a cap of eight means eight
  -- in his working day, and a UTC day would split it across two of his.
  if v_policy.max_per_day is not null then
    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.agent_user_id = p_agent_user_id
       and a.status in ('booked', 'confirmed')
       and (a.starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
           = (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date;

    if v_booked_that_day >= v_policy.max_per_day then
      raise exception 'APPOINTMENT_DAILY_CAP_REACHED';
    end if;
  end if;

  -- [added] The agency's cap: every live appointment in the tenant that day, in the agency's own
  -- timezone. The lock makes "count, then insert" one decision per tenant-day.
  select s.max_per_day into v_agency_cap from tenant_booking_settings s where s.tenant_id = p_tenant_id;
  if v_agency_cap is not null then
    begin
      select nullif(btrim(ap.timezone), '') into v_agency_zone from agency_profiles ap where ap.tenant_id = p_tenant_id;
    exception when undefined_table or undefined_column then
      v_agency_zone := null;
    end;
    v_agency_zone := coalesce(v_agency_zone, v_zone, 'UTC');
    v_agency_day := (p_starts_at_utc at time zone v_agency_zone)::date;
    perform pg_advisory_xact_lock(hashtextextended('booking-cap:' || p_tenant_id::text || ':' || v_agency_day::text, 0));

    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.starts_at_utc >= (v_agency_day::timestamp at time zone v_agency_zone)
       and a.starts_at_utc < ((v_agency_day + 1)::timestamp at time zone v_agency_zone);

    if v_booked_that_day >= v_agency_cap then
      raise exception 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED';
    end if;
  end if;

  -- The overlap itself is NOT checked here — buffer included. The exclusion constraint decides it,
  -- seat by seat, which is the only way two setters racing on the same slot get one winner.
  begin
    insert into tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
       customer_timezone, notes, buffer_minutes, seat)
    values
      (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
       v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 1)
    returning id into v_id;
  exception when exclusion_violation then
    -- [added] Double-booking allowed: the second seat. Refused in turn if it is taken too.
    if not coalesce(v_policy.allow_double_booking, false) then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end if;
    v_seat := 2;
  end;

  if v_id is null and v_seat = 2 then
    begin
      insert into tenant_appointments
        (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
         customer_timezone, notes, buffer_minutes, seat)
      values
        (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
         v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 2)
      returning id into v_id;
    exception when exclusion_violation then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end;
  end if;

  return query select v_id, p_starts_at_utc, v_minutes,
    format('Booked for %s in the customer''s %s.', p_starts_at_utc at time zone v_customer_zone, v_customer_zone)
      || case when v_seat = 2 then ' Double-booked: this slot already had an appointment.' else '' end;
end;
$function$;

revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';
  if v_def is null or v_def !~ 'APPOINTMENT_AGENT_HAS_NO_HOURS' then
    raise exception 'book_appointment does not refuse an agent with no working hours';
  end if;
  -- Nothing the previous definition enforced was lost in the rewrite.
  if v_def !~ 'APPOINTMENT_IN_THE_PAST' or v_def !~ 'APPOINTMENT_LEAD_HAS_NO_STATE'
     or v_def !~ 'APPOINTMENT_CALLING_RULES_STALE' or v_def !~ 'APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW'
     or v_def !~ 'APPOINTMENT_SAME_DAY_NOT_ALLOWED' or v_def !~ 'APPOINTMENT_OUTSIDE_AVAILABILITY'
     or v_def !~ 'APPOINTMENT_BLOCKED_TIME' or v_def !~ 'b\.repeats'
     or v_def !~ 'APPOINTMENT_LINKED_CALENDAR_BUSY' or v_def !~ 'APPOINTMENT_DAILY_CAP_REACHED'
     or v_def !~ 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED' or v_def !~ 'allow_double_booking'
     or v_def !~ 'APPOINTMENT_SLOT_TAKEN' then
    raise exception 'book_appointment is missing a rule after the 704000 rewrite';
  end if;

  if has_function_privilege('tenant_app', 'public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer)', 'execute') then
    raise exception 'the tenant plane can call book_appointment directly';
  end if;
end $$;
