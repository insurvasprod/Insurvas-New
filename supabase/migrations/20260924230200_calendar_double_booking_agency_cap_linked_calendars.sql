-- ---------------------------------------------------------------------------
-- Settings · Calendar & availability — the three things the board says and booking did not do
--
-- 1. ALLOW DOUBLE-BOOKING. "Two appointments in one slot." Per agent, default off (today's rule).
--    The exclusion constraint that refuses an overlap stays the only arbiter — that is what makes
--    two setters racing on one slot get one winner — but it now counts SEATS: every live
--    appointment holds seat 1 or seat 2, and the constraint refuses an overlap only within a seat.
--    `book_appointment` takes seat 1; if that collides and the agent allows double-booking, it tries
--    seat 2; if that collides too, the slot is taken. So "two in one slot" is exactly two, never
--    three, and the race is still settled by the index rather than by a count that is stale by the
--    time the insert runs. Existing rows get seat 1, which makes the new constraint identical to
--    the old one on every row that satisfied it.
--
-- 2. MAXIMUM PER DAY, ACROSS THE WHOLE AGENCY. The board: "Across the whole agency, not per agent."
--    `tenant_booking_settings.max_per_day` (null = no agency cap). Counted over every live
--    appointment in the tenant on the booked day, in the agency's timezone (Agency profile), else
--    the agent's, else UTC. A per-tenant-day advisory lock makes the count and the insert one
--    decision, so two setters cannot both take the last place. The per-agent cap
--    (`tenant_agent_booking_policy.max_per_day`) is kept and still enforced; both must pass.
--
-- 3. HONOUR LINKED CALENDARS. Stored since 20260924120000 and read by nothing, because there was
--    no calendar integration. This adds the integration's data model and the rule that reads it:
--
--      tenant_connected_calendars  one row per agent per provider (google | microsoft): status,
--                                  the account, the encrypted refresh token, last sync, last error.
--                                  Service role only — no tenant-plane grant on tokens.
--      tenant_calendar_busy        busy intervals synced from a connected calendar.
--      replace_calendar_busy       swaps one calendar's busy set in a single transaction.
--
--    `book_appointment` refuses a start that overlaps busy time from a CONNECTED calendar when the
--    agent's `honour_linked_calendars` is on (APPOINTMENT_LINKED_CALENDAR_BUSY). With no calendar
--    connected there is no busy time, and the screen says so instead of offering a switch that
--    does nothing. The OAuth apps that fill these tables are configured outside the database; see
--    lib/appointments/linkedCalendars.ts for exactly which credentials.
--
-- Also: a stale state-rules feed (20260924230100) refuses a booking with its own code
-- (APPOINTMENT_CALLING_RULES_STALE) instead of reporting "outside the customer's window".
--
-- `book_appointment` is reproduced from 20260924120000 (applied); every rule is kept in the same
-- order with the same exception names. The additions are marked.
-- ---------------------------------------------------------------------------

-- ── 1. seats ───────────────────────────────────────────────────────────────
alter table public.tenant_agent_booking_policy
  add column if not exists allow_double_booking boolean not null default false;

alter table public.tenant_appointments
  add column if not exists seat smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_appointments_seat_known') then
    alter table public.tenant_appointments
      add constraint tenant_appointments_seat_known check (seat in (1, 2));
  end if;
end $$;

-- Same name, same scope (live appointments only), same buffer-inclusive range; one more column.
-- Dropped and re-added in one migration transaction, so there is no moment without a constraint.
alter table public.tenant_appointments
  drop constraint if exists tenant_appointments_no_double_booking;
alter table public.tenant_appointments
  add constraint tenant_appointments_no_double_booking
  exclude using gist (
    tenant_id with =,
    agent_user_id with =,
    seat with =,
    tstzrange(starts_at_utc, occupied_until_utc, '[)') with &&
  ) where (status in ('booked', 'confirmed'));

-- ── 2. the agency's daily cap ──────────────────────────────────────────────
create table if not exists public.tenant_booking_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_per_day integer check (max_per_day is null or max_per_day between 1 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create index if not exists tenant_booking_settings_updated_by_idx
  on public.tenant_booking_settings (updated_by);

alter table public.tenant_booking_settings enable row level security;
drop policy if exists tenant_booking_settings_scoped on public.tenant_booking_settings;
create policy tenant_booking_settings_scoped on public.tenant_booking_settings for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_booking_settings from anon, authenticated, public;
grant select, insert, update on public.tenant_booking_settings to tenant_app;
grant select, insert, update, delete on public.tenant_booking_settings to service_role;

-- The agency cap counts a tenant's appointments by day.
create index if not exists tenant_appointments_tenant_live_start_idx
  on public.tenant_appointments (tenant_id, starts_at_utc)
  where status in ('booked', 'confirmed');

-- ── 3. linked calendars ────────────────────────────────────────────────────
create table if not exists public.tenant_connected_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'revoked')),
  account_email text check (account_email is null or char_length(account_email) <= 320),
  -- The OAuth `state` nonce while a connection is pending; cleared once it completes.
  oauth_state text unique,
  oauth_state_expires_at timestamptz,
  -- AES-256-GCM, encrypted by the application with CALENDAR_TOKEN_KEY. Never readable in the tenant
  -- plane: this table has no tenant_app grant at all.
  refresh_token_ciphertext text,
  scopes text[] not null default array[]::text[],
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);

create index if not exists tenant_connected_calendars_user_idx
  on public.tenant_connected_calendars (tenant_id, user_id);
create index if not exists tenant_connected_calendars_user_fk_idx
  on public.tenant_connected_calendars (user_id);

create table if not exists public.tenant_calendar_busy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  calendar_id uuid not null references public.tenant_connected_calendars(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists tenant_calendar_busy_lookup_idx
  on public.tenant_calendar_busy (tenant_id, user_id, ends_at);
create index if not exists tenant_calendar_busy_calendar_idx
  on public.tenant_calendar_busy (calendar_id);
create index if not exists tenant_calendar_busy_user_fk_idx
  on public.tenant_calendar_busy (user_id);

alter table public.tenant_connected_calendars enable row level security;
alter table public.tenant_calendar_busy enable row level security;
-- No tenant_app policy or grant: the tokens and the busy cache are handled by the server only.
revoke all on public.tenant_connected_calendars, public.tenant_calendar_busy from anon, authenticated, public, tenant_app;
grant select, insert, update, delete on public.tenant_connected_calendars, public.tenant_calendar_busy to service_role;

create or replace function public.replace_calendar_busy(p_calendar_id uuid, p_rows jsonb, p_synced_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cal record;
  v_count integer;
begin
  select * into v_cal from tenant_connected_calendars where id = p_calendar_id for update;
  if not found then raise exception 'CALENDAR_NOT_FOUND'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'CALENDAR_BUSY_ROWS_INVALID'; end if;

  delete from tenant_calendar_busy where calendar_id = p_calendar_id;
  insert into tenant_calendar_busy (tenant_id, user_id, calendar_id, starts_at, ends_at, fetched_at)
  select v_cal.tenant_id, v_cal.user_id, p_calendar_id,
         (e->>'startsAt')::timestamptz, (e->>'endsAt')::timestamptz, p_synced_at
    from jsonb_array_elements(p_rows) e
   where (e->>'endsAt')::timestamptz > (e->>'startsAt')::timestamptz;
  get diagnostics v_count = row_count;

  update tenant_connected_calendars
     set status = 'connected', last_synced_at = p_synced_at, last_error = null, updated_at = now()
   where id = p_calendar_id;
  return v_count;
end;
$function$;

revoke all on function public.replace_calendar_busy(uuid, jsonb, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_calendar_busy(uuid, jsonb, timestamptz) to service_role;

-- ── booking, with every rule the server owns ───────────────────────────────
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
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.tenant_appointments'::regclass
     and c.conname = 'tenant_appointments_no_double_booking';
  if v_def is null or v_def !~ 'occupied_until_utc' or v_def !~ 'seat' then
    raise exception 'the double-booking constraint lost the buffer or the seat: %', v_def;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';
  if v_def !~ 'APPOINTMENT_SAME_DAY_NOT_ALLOWED' or v_def !~ 'b\.repeats' or v_def !~ 'APPOINTMENT_DAILY_CAP_REACHED'
     or v_def !~ 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED' or v_def !~ 'APPOINTMENT_LINKED_CALENDAR_BUSY'
     or v_def !~ 'allow_double_booking' then
    raise exception 'book_appointment is missing a rule after the rewrite';
  end if;

  if has_table_privilege('tenant_app', 'public.tenant_connected_calendars', 'select') then
    raise exception 'the tenant plane can read calendar tokens';
  end if;
end $$;
