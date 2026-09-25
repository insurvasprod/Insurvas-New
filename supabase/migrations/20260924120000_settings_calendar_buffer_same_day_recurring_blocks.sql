-- ---------------------------------------------------------------------------
-- Settings · Calendar & availability — the three things the screen said and the database did not do
--
-- 1. THE BUFFER. `tenant_agent_booking_policy.buffer_minutes` has been stored since LA-2.11 and read
--    by nothing that decides anything. Two back-to-back appointments were accepted whatever it said.
--    It is now enforced by the same exclusion constraint that refuses double-booking, rather than by
--    a check inside `book_appointment`: a check reads rows that are already stale by the time the
--    insert runs, and the whole point of that constraint is that the database settles the race.
--
--    Each appointment records the buffer in force when it was booked (`buffer_minutes`), and a
--    trigger stamps `occupied_until_utc = ends_at_utc + buffer`. The constraint excludes overlapping
--    [starts_at_utc, occupied_until_utc) ranges, so "a 30-minute slot consumes 40" is literally what
--    the index holds. Existing rows get a buffer of 0, which makes their ranges identical to the ones
--    the old constraint used — re-adding it cannot fail on data that satisfied the old one.
--
-- 2. SAME-DAY BOOKING. A new per-agent switch, `allow_same_day` (default true, which is today's
--    behaviour). Off, `book_appointment` refuses any start that falls on today's date in the agent's
--    own zone.
--
-- 3. RECURRING BLOCKED TIME. `tenant_agent_blocks.repeats` — none | daily | weekdays | weekly | yearly.
--    A repeating block repeats its own wall-clock time in the agent's zone, from its first date on.
--    `book_appointment` now checks every occurrence that could touch the requested range, not only
--    the stored instant.
--
-- Also stored, and deliberately NOT enforced: `honour_linked_calendars`. There is no Google or
-- Outlook integration, so there is no busy time to honour. The screen says so ("No calendars linked
-- yet") instead of pretending.
--
-- `book_appointment` is reproduced in full from 20260913370000 (the only migration that defines it).
-- Every existing rule is kept in the same order with the same exception names; the additions are the
-- buffer written on insert, the same-day refusal, and the recurring-block branch.
-- ---------------------------------------------------------------------------

-- ── policy ─────────────────────────────────────────────────────────────────
alter table public.tenant_agent_booking_policy
  add column if not exists allow_same_day boolean not null default true,
  add column if not exists honour_linked_calendars boolean not null default true;

-- ── recurring blocks ───────────────────────────────────────────────────────
alter table public.tenant_agent_blocks
  add column if not exists repeats text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_agent_blocks_repeats_known') then
    alter table public.tenant_agent_blocks
      add constraint tenant_agent_blocks_repeats_known
      check (repeats in ('none', 'daily', 'weekdays', 'weekly', 'yearly'));
  end if;
end $$;

-- ── the buffer, held by the constraint ─────────────────────────────────────
alter table public.tenant_appointments
  add column if not exists buffer_minutes integer not null default 0,
  add column if not exists occupied_until_utc timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_appointments_buffer_sane') then
    alter table public.tenant_appointments
      add constraint tenant_appointments_buffer_sane check (buffer_minutes between 0 and 120);
  end if;
end $$;

-- The table is small (one row per booked appointment), so a single statement is fine here.
update public.tenant_appointments
   set occupied_until_utc = ends_at_utc + make_interval(mins => buffer_minutes)
 where occupied_until_utc is null;

create or replace function public.stamp_appointment_end()
returns trigger
language plpgsql
as $function$
begin
  new.ends_at_utc := new.starts_at_utc + make_interval(mins => new.duration_minutes);
  -- The buffer rides on the appointment that was booked with it, so a later change to the agent's
  -- policy never retroactively collides two appointments that were legal when they were made.
  new.occupied_until_utc := new.ends_at_utc + make_interval(mins => coalesce(new.buffer_minutes, 0));
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists tenant_appointments_end on public.tenant_appointments;
create trigger tenant_appointments_end
  before insert or update of starts_at_utc, duration_minutes, buffer_minutes on public.tenant_appointments
  for each row execute function public.stamp_appointment_end();

-- No default: the BEFORE trigger always stamps it, and NOT NULL is checked after BEFORE triggers.
alter table public.tenant_appointments
  alter column occupied_until_utc set not null;

-- Same name, same scope (live appointments only), wider range. Dropped and re-added in one
-- migration transaction, so there is no moment without a constraint.
alter table public.tenant_appointments
  drop constraint if exists tenant_appointments_no_double_booking;
alter table public.tenant_appointments
  add constraint tenant_appointments_no_double_booking
  exclude using gist (
    tenant_id with =,
    agent_user_id with =,
    tstzrange(starts_at_utc, occupied_until_utc, '[)') with &&
  ) where (status in ('booked', 'confirmed'));

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

    -- Repeating blocks: every occurrence whose day could reach the requested range. An occurrence
    -- keeps the block's wall-clock start in the agent's zone and its stored length, and none exists
    -- before the block's first date.
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

  -- The overlap itself is NOT checked here — buffer included. The exclusion constraint decides it,
  -- which is the only way two setters racing on the same slot get one winner rather than two rows.
  begin
    insert into tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
       customer_timezone, notes, buffer_minutes)
    values
      (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
       v_customer_zone, nullif(btrim(p_notes), ''), v_buffer)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_SLOT_TAKEN';
  end;

  return query select v_id, p_starts_at_utc, v_minutes,
    format('Booked for %s in the customer''s %s.', p_starts_at_utc at time zone v_customer_zone, v_customer_zone);
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
  if v_def is null or v_def !~ 'occupied_until_utc' then
    raise exception 'the double-booking constraint does not include the buffer: %', v_def;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';
  if v_def !~ 'APPOINTMENT_SAME_DAY_NOT_ALLOWED' or v_def !~ 'b\.repeats' or v_def !~ 'APPOINTMENT_DAILY_CAP_REACHED' then
    raise exception 'book_appointment is missing a rule after the rewrite';
  end if;
end $$;
