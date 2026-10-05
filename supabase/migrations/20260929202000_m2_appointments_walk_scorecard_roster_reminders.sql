-- ---------------------------------------------------------------------------
-- Module 2 · appointments and setters (FIX builder A, 2026-09-29)
--
-- LA-2.11-5  The walk is booked -> confirmed -> showed / no_show / cancelled / rescheduled.
--            mark_appointment_outcome gains 'confirmed' (from booked, before the slot, and a setter
--            may confirm a booking of their own), and refuses 'showed' or 'no_show' on an
--            appointment that has not started (APPOINTMENT_NOT_YET_HELD). 'rescheduled' leaves the
--            outcome list: a reschedule books its new slot in the same statement
--            (reschedule_appointment), and a row marked rescheduled with no replacement would drop a
--            booking out of the setter's count.
-- LA-2.12-4  A reschedule counts ONCE in booked, credited to whoever booked it first.
--            tenant_appointments gains rescheduled_from and first_booked_at. reschedule_appointment
--            keeps the original booked_by and first booking time on the replacement, and the
--            scorecard (tenant_setter_scorecard, setter_scorecard_for_agent) no longer counts a row
--            that was rescheduled. Existing chains are linked by the transaction time they share.
-- LA-2.12-2  A setter moves or rebooks only their own bookings (APPOINTMENT_NOT_YOURS).
-- LA-2.12-6  tenant_member_roster lists every accepted owner, producer and setter, with or without
--            working hours. Without them the local time is the agency's and on_shift_now is null.
-- LA-2.11-9  The in-app half of appointment reminders runs on pg_cron with no app host:
--            run_appointment_in_app_reminders writes the agent's alert, in the agent's own zone with
--            the customer's local time beside it, and the recipient ledger row. Email stays with the
--            app job (claim_appointment_reminders is unchanged and uses its own marker).
--            The close-out pass (close_out_due_appointments) also had no host and now runs on
--            pg_cron every five minutes, so past appointments reach showed or pending.
--
-- Restated from the LIVE bodies (read 2026-09-29): mark_appointment_outcome (20260913415000),
-- reschedule_appointment and rebook_appointment (20260925704200), setter_scorecard_for_agent
-- (20260925704300) and both views (20260913415000, 20260913380000). [202000] marks each change.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

-- ── columns ────────────────────────────────────────────────────────────────
alter table public.tenant_appointments
  add column if not exists rescheduled_from uuid references public.tenant_appointments(id) on delete set null,
  add column if not exists first_booked_at timestamptz,
  add column if not exists in_app_reminded_at timestamptz;

create index if not exists tenant_appointments_rescheduled_from_idx
  on public.tenant_appointments (rescheduled_from)
  where rescheduled_from is not null;
create index if not exists tenant_appointments_in_app_reminder_due_idx
  on public.tenant_appointments (starts_at_utc)
  where in_app_reminded_at is null and status in ('booked', 'confirmed');

-- ── existing reschedule chains ─────────────────────────────────────────────
-- reschedule_appointment marks the old row and inserts the new one in one transaction, so the old
-- row's updated_at is exactly the new row's created_at. Oldest first, re-reading the old row each
-- time, so a chain of several moves carries the first booker all the way down.
do $$
declare
  r record;
  v_by uuid;
  v_first timestamptz;
  v_rebooked uuid;
  v_links integer := 0;
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.tenant_appointments'::regclass and not attisdropped
                    and attname = 'rescheduled_from') then
    raise notice '20260929202000: tenant_appointments.rescheduled_from is missing, chains not linked';
    return;
  end if;
  for r in
    select o.id as old_id, n.id as new_id
      from public.tenant_appointments o
      join public.tenant_appointments n
        on n.tenant_id = o.tenant_id and n.lead_id = o.lead_id and n.agent_user_id = o.agent_user_id
       and n.id <> o.id and n.created_at = o.updated_at
     where o.status = 'rescheduled' and n.rescheduled_from is null
     order by o.created_at, o.id
  loop
    select t.booked_by, coalesce(t.first_booked_at, t.created_at), t.rebooked_from
      into v_by, v_first, v_rebooked
      from public.tenant_appointments t where t.id = r.old_id;
    update public.tenant_appointments t
       set rescheduled_from = r.old_id,
           booked_by = coalesce(v_by, t.booked_by),
           first_booked_at = v_first,
           rebooked_from = coalesce(v_rebooked, t.rebooked_from)
     where t.id = r.new_id;
    v_links := v_links + 1;
  end loop;
  raise notice '20260929202000: linked % rescheduled appointment(s) to their replacement', v_links;
end $$;

-- ── the walk ───────────────────────────────────────────────────────────────
create or replace function public.mark_appointment_outcome(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  a record;
begin
  -- [202000] 'confirmed' joins the walk, 'rescheduled' leaves it (reschedule_appointment books the
  -- new slot in the same statement).
  if p_outcome is null or p_outcome not in ('confirmed', 'showed', 'no_show', 'cancelled') then
    raise exception 'APPOINTMENT_OUTCOME_UNKNOWN';
  end if;

  select tu.role::text into v_role
    from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;

  if v_role is null then
    raise exception 'ACTOR_NOT_A_MEMBER';
  end if;

  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_ACTIVE';
  end if;

  if p_outcome = 'confirmed' then
    -- [202000] Confirming is not a measurement, so a setter may confirm a booking of their own.
    if v_role = 'setter' and a.booked_by is distinct from p_actor then
      raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
    end if;
    if a.status = 'confirmed' then
      return;
    end if;
    if a.status <> 'booked' then
      raise exception 'APPOINTMENT_NOT_ACTIVE';
    end if;
    if a.starts_at_utc <= now() then
      raise exception 'APPOINTMENT_ALREADY_STARTED';
    end if;
  else
    -- Unchanged, and it is the reason the number means anything: the person being measured does
    -- not write the measurement.
    if v_role = 'setter' then
      raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
    end if;
    if a.status not in ('booked', 'confirmed', 'pending') then
      raise exception 'APPOINTMENT_NOT_ACTIVE';
    end if;
    -- [202000] Nobody has shown up, or failed to, for a call that has not happened yet.
    if p_outcome in ('showed', 'no_show') and a.starts_at_utc > now() then
      raise exception 'APPOINTMENT_NOT_YET_HELD';
    end if;
  end if;

  update tenant_appointments
     set status = p_outcome, updated_at = now()
   where id = a.id;
end;
$function$;

revoke all on function public.mark_appointment_outcome(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_appointment_outcome(uuid, uuid, uuid, text) to tenant_app, service_role;

-- ── reschedule: one booking, the first booker's ────────────────────────────
create or replace function public.reschedule_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz
)
returns table (appointment_id uuid, starts_at_utc timestamptz, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_new uuid;
  v_result record;
  v_role text;
begin
  select * into a from tenant_appointments
   where id = p_appointment_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'APPOINTMENT_NOT_ACTIVE'; end if;

  -- [202000] A setter moves their own bookings, never a colleague's.
  select tu.role::text into v_role from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role = 'setter' and a.booked_by is distinct from p_actor then
    raise exception 'APPOINTMENT_NOT_YOURS';
  end if;

  -- The old row leaves the constraint's scope FIRST, in the same transaction, so the new time may
  -- legitimately be the old one and a reschedule can never collide with itself. If the booking
  -- below fails, this rolls back with it and the original slot is still held.
  update tenant_appointments set status = 'rescheduled', updated_at = now() where id = a.id;

  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, a.agent_user_id, p_actor, p_starts_at_utc, a.notes, a.duration_minutes);
  v_new := v_result.appointment_id;

  -- [202000] The same booking, moved: credited to whoever booked it first, on the day they did,
  -- and linked to the row it replaces. [704200] A rebooking keeps its rebooked_from.
  update tenant_appointments
     set booked_by = coalesce(a.booked_by, booked_by),
         rescheduled_from = a.id,
         first_booked_at = coalesce(a.first_booked_at, a.created_at),
         rebooked_from = coalesce(a.rebooked_from, rebooked_from)
   where id = v_new;

  return query select v_new, p_starts_at_utc, 'Rescheduled; the previous slot is free.'::text;
end;
$function$;

revoke all on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) to service_role;

-- ── rebook a no-show: a setter rebooks their own ───────────────────────────
create or replace function public.rebook_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz,
  p_agent_user_id uuid default null
)
returns table (appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_result record;
  v_role text;
begin
  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status <> 'no_show' then raise exception 'APPOINTMENT_NOT_A_NO_SHOW'; end if;

  -- [202000] A setter rebooks their own no-shows, never a colleague's.
  select tu.role::text into v_role from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role = 'setter' and a.booked_by is distinct from p_actor then
    raise exception 'APPOINTMENT_NOT_YOURS';
  end if;

  -- One live rebooking per no-show. A rebooking that was itself cancelled frees it again; one that
  -- was rescheduled is followed by its replacement, which carries the same `rebooked_from`.
  if exists (
    select 1 from tenant_appointments r
     where r.tenant_id = p_tenant_id and r.rebooked_from = a.id
       and r.status in ('booked', 'confirmed', 'pending', 'showed')
  ) then
    raise exception 'APPOINTMENT_ALREADY_REBOOKED';
  end if;

  -- Every booking rule, unchanged: the customer's window, hours, blocks, caps and the slot race.
  -- The actor is `booked_by`, and the duration is the agent's current policy, not the old slot's.
  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, coalesce(p_agent_user_id, a.agent_user_id), p_actor, p_starts_at_utc, a.notes, null);

  update tenant_appointments t set rebooked_from = a.id, updated_at = now()
   where t.id = v_result.appointment_id;

  return query select v_result.appointment_id, v_result.starts_at_utc, v_result.duration_minutes,
    ('Rebooked. ' || v_result.reason || ' The no-show stays on the record.')::text;
end;
$function$;

revoke all on function public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid) to service_role;

-- ── the scorecard: a reschedule is one booking ─────────────────────────────
-- Same columns, same order, so create or replace keeps the view's grants and options. Built through
-- execute behind a column check, so a run where the column add above was refused (the parse
-- checker's role) reports it instead of failing on a column that is not there. The assertions
-- below refuse a real apply that left the old view in place.
do $view$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.tenant_appointments'::regclass and not attisdropped
                    and attname = 'first_booked_at') then
    raise notice '20260929202000: tenant_appointments.first_booked_at is missing, the scorecard view is unchanged';
    return;
  end if;
  execute $sql$
create or replace view public.tenant_setter_scorecard as
with attempts as (
  select ca.tenant_id, ca.agent_id as user_id, ca.attempted_at, ca.disposition
    from tenant_call_attempts ca
   where ca.agent_id is not null
),
dials as (
  select a.tenant_id, a.user_id, date_trunc('day', a.attempted_at) as day,
         count(*) as dials,
         count(*) filter (where is_contact_disposition(a.disposition)) as contacts
    from attempts a
   group by 1, 2, 3
),
booked as (
  -- [202000] Bucketed by when the booking was first made, which a reschedule carries forward.
  select ap.tenant_id, ap.booked_by as user_id, date_trunc('day', coalesce(ap.first_booked_at, ap.created_at)) as day,
         count(*) as booked,
         count(*) filter (where ap.status = 'showed') as showed,
         count(*) filter (where ap.status = 'no_show') as no_show,
         -- Still waiting for a human, and still inside the window where one might answer.
         count(*) filter (where ap.status = 'pending'
                            and ap.starts_at_utc >= now() - interval '3 days') as pending,
         -- Gave up waiting. Excluded from the rate entirely, and counted here so the gap is
         -- visible rather than merely absent.
         count(*) filter (where ap.status = 'pending'
                            and ap.starts_at_utc < now() - interval '3 days') as never_closed_out,
         count(*) filter (where ap.status in ('booked', 'confirmed')) as upcoming,
         count(*) filter (
           where exists (
             select 1 from tenant_call_attempts ca2
              where ca2.tenant_id = ap.tenant_id
                and ca2.lead_id = ap.lead_id
                and ca2.attempted_at >= ap.starts_at_utc
                and ca2.disposition in ('application_submitted', 'sent_to_underwriting')
           )
         ) as sold
    from tenant_appointments ap
   where ap.booked_by is not null
     -- [202000] A rescheduled row is superseded by its replacement, which carries the booking.
     and ap.status <> 'rescheduled'
   group by 1, 2, 3
)
select coalesce(d.tenant_id, b.tenant_id) as tenant_id,
       coalesce(d.user_id, b.user_id) as user_id,
       coalesce(d.day, b.day) as day,
       coalesce(d.dials, 0) as dials,
       coalesce(d.contacts, 0) as contacts,
       coalesce(b.booked, 0) as booked,
       coalesce(b.showed, 0) as showed,
       coalesce(b.no_show, 0) as no_show,
       coalesce(b.pending, 0) as pending,
       coalesce(b.never_closed_out, 0) as never_closed_out,
       coalesce(b.sold, 0) as sold,
       case when coalesce(b.showed, 0) + coalesce(b.no_show, 0) > 0
            then round(100.0 * b.showed / (b.showed + b.no_show), 1) end as show_rate_pct,
       coalesce(b.showed, 0) + coalesce(b.no_show, 0) as closed_out,
       coalesce(b.booked, 0) - coalesce(b.upcoming, 0) as closeable,
       case when coalesce(b.booked, 0) - coalesce(b.upcoming, 0) > 0
            then round(100.0 * (coalesce(b.showed, 0) + coalesce(b.no_show, 0))
                       / (b.booked - b.upcoming), 1) end as coverage_pct,
       case when coalesce(d.contacts, 0) > 0
            then round(100.0 * coalesce(b.booked, 0) / d.contacts, 1) end as book_per_contact_pct
  from dials d
  full outer join booked b
    on b.tenant_id = d.tenant_id and b.user_id = d.user_id and b.day = d.day
$sql$;
end $view$;

alter view public.tenant_setter_scorecard set (security_invoker = on);
revoke all on public.tenant_setter_scorecard from anon, authenticated, public;
grant select on public.tenant_setter_scorecard to tenant_app, service_role;

create or replace function public.setter_scorecard_for_agent(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_since timestamptz
)
returns table (user_id uuid, booked integer, showed integer, no_show integer, pending integer, sold integer, dials integer, contacts integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select ap.booked_by, ap.status, ap.lead_id, ap.starts_at_utc, ap.tenant_id
      from tenant_appointments ap
     where ap.tenant_id = p_tenant_id
       and ap.agent_user_id = p_agent_user_id
       and ap.booked_by is not null
       and ap.booked_by <> p_agent_user_id
       -- [202000] one booking per reschedule chain, dated by its first booking
       and ap.status <> 'rescheduled'
       and coalesce(ap.first_booked_at, ap.created_at) >= p_since
  ),
  booked as (
    select m.booked_by as user_id,
           count(*)::integer as booked,
           count(*) filter (where m.status = 'showed')::integer as showed,
           count(*) filter (where m.status = 'no_show')::integer as no_show,
           count(*) filter (where m.status = 'pending')::integer as pending,
           count(*) filter (
             where exists (
               select 1 from tenant_call_attempts ca2
                where ca2.tenant_id = m.tenant_id
                  and ca2.lead_id = m.lead_id
                  and ca2.attempted_at >= m.starts_at_utc
                  and ca2.disposition in ('application_submitted', 'sent_to_underwriting')
             )
           )::integer as sold
      from mine m
     group by m.booked_by
  )
  select b.user_id, b.booked, b.showed, b.no_show, b.pending, b.sold,
         coalesce(d.dials, 0)::integer, coalesce(d.contacts, 0)::integer
    from booked b
    left join lateral (
      select count(*) as dials,
             count(*) filter (where is_contact_disposition(ca.disposition)) as contacts
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id
         and ca.agent_id = b.user_id
         and ca.attempted_at >= p_since
    ) d on true;
$function$;

revoke all on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) to service_role;

-- ── the roster: every setter, with or without hours ────────────────────────
-- Same columns, same order. A member with no working hours gets the agency's clock and a null
-- on_shift_now (unknown, not off shift). The agency zone is used only when Postgres knows it, so a
-- bad value in the profile can never break the whole view.
create or replace view public.tenant_member_roster as
select tu.tenant_id,
       tu.user_id,
       tu.role::text as role,
       z.zone as timezone,
       (now() at time zone z.zone) as local_time,
       to_char(now() at time zone z.zone, 'Dy HH24:MI') as local_label,
       av.start_time,
       av.end_time,
       case when av.user_id is null then null
            else (
              extract(dow from (now() at time zone av.timezone))::smallint = av.weekday
              and (now() at time zone av.timezone)::time >= av.start_time
              and (now() at time zone av.timezone)::time < av.end_time
            ) end as on_shift_now
  from tenant_users tu
  left join tenant_agent_availability av
    on av.tenant_id = tu.tenant_id and av.user_id = tu.user_id
  left join agency_profiles ag
    on ag.tenant_id = tu.tenant_id
  cross join lateral (
    select coalesce(
             nullif(btrim(av.timezone), ''),
             (select tz.name from pg_timezone_names tz where tz.name = nullif(btrim(ag.timezone), '') limit 1),
             'UTC') as zone
  ) z
 where tu.accepted_at is not null
   -- [202000] every setter (and every calendar holder) even with no hours, plus anyone else who has them
   and (av.user_id is not null or tu.role::text in ('owner', 'producer', 'setter'));

alter view public.tenant_member_roster set (security_invoker = on);
revoke all on public.tenant_member_roster from anon, authenticated, public;
grant select on public.tenant_member_roster to tenant_app, service_role;

-- ── appointment reminders, the in-app half, on pg_cron ─────────────────────
-- The lead time matches the app's email job (24 hours), overridable platform-wide by
-- appointments.reminder_lead_minutes. The notification's source key is the one the app job uses, so
-- whichever runs second writes nothing new.
create or replace function public.run_appointment_in_app_reminders(p_now timestamptz default now(), p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_minutes integer := 1440;
  v_raw text;
  v_count integer := 0;
  v_name text;
  v_zone text;
  v_agency_zone text;
  v_agent_local text;
  v_customer_local text;
  a record;
begin
  if to_regclass('public.settings') is not null then
    select s.value #>> '{}' into v_raw from public.settings s where s.key = 'appointments.reminder_lead_minutes';
    if v_raw ~ '^\s*\d+(\.\d+)?\s*$' then
      v_minutes := greatest(5, least(10080, round(v_raw::numeric)::integer));
    end if;
  end if;

  for a in
    select ap.id, ap.tenant_id, ap.lead_id, ap.agent_user_id, ap.starts_at_utc, ap.customer_timezone, l.values
      from public.tenant_appointments ap
      join public.agent_leads l on l.id = ap.lead_id and l.tenant_id = ap.tenant_id
      join public.users u on u.id = ap.agent_user_id and u.status::text = 'active'
     where ap.status in ('booked', 'confirmed')
       and ap.in_app_reminded_at is null
       and ap.starts_at_utc > p_now
       and ap.starts_at_utc <= p_now + make_interval(mins => v_minutes)
     order by ap.starts_at_utc, ap.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update of ap skip locked
  loop
    -- The agent's own zone (their working hours), else the agency's, else UTC.
    select nullif(btrim(av.timezone), '') into v_zone
      from public.tenant_agent_availability av
     where av.tenant_id = a.tenant_id and av.user_id = a.agent_user_id
     order by av.weekday
     limit 1;
    if v_zone is null then
      select tz.name into v_agency_zone
        from public.agency_profiles ag
        join pg_timezone_names tz on tz.name = nullif(btrim(ag.timezone), '')
       where ag.tenant_id = a.tenant_id
       limit 1;
      v_zone := coalesce(v_agency_zone, 'UTC');
    end if;

    v_name := coalesce(nullif(btrim(a.values->>'full_name'), ''),
                       nullif(btrim(a.values->>'name'), ''),
                       nullif(btrim(concat_ws(' ', a.values->>'first_name', a.values->>'last_name')), ''),
                       'Customer');
    v_agent_local := to_char(a.starts_at_utc at time zone v_zone, 'Mon FMDD, YYYY, FMHH12:MI AM');
    v_customer_local := to_char(a.starts_at_utc at time zone a.customer_timezone, 'Mon FMDD, YYYY, FMHH12:MI AM');

    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    values (a.tenant_id, a.agent_user_id, 'appointment_reminder',
            left('Appointment reminder: ' || v_name, 160),
            'Appointment at ' || v_agent_local || ' (' || v_zone || ')' || '. Customer local time '
              || v_customer_local || ' (' || a.customer_timezone || ').',
            '/app/calendar?appointment=' || a.id::text,
            'appointment-reminder:' || a.id::text || ':agent:' || lower(a.agent_user_id::text))
    on conflict (tenant_id, recipient_user_id, source_key) do nothing;

    insert into public.tenant_appointment_reminder_events
      (tenant_id, appointment_id, recipient_type, recipient_key, customer_local, agent_local,
       customer_timezone, agent_timezone, delivery_status, delivered_at, created_at, updated_at)
    values
      (a.tenant_id, a.id, 'agent', a.agent_user_id::text, v_customer_local, v_agent_local,
       a.customer_timezone, v_zone, 'delivered', p_now, p_now, p_now)
    on conflict (appointment_id, recipient_type, recipient_key) do nothing;

    update public.tenant_appointments set in_app_reminded_at = p_now where id = a.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.run_appointment_in_app_reminders(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_appointment_in_app_reminders(timestamptz, integer) to service_role;

-- ── the close-out pass, on pg_cron ─────────────────────────────────────────
-- Per tenant, and one tenant's failure is reported and skipped, never allowed to stop the others.
create or replace function public.run_appointment_close_out(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  r record;
  v_row record;
  v_total integer := 0;
begin
  for r in
    select distinct t.tenant_id
      from public.tenant_appointments t
     where t.status in ('booked', 'confirmed') and t.ends_at_utc <= p_at
  loop
    begin
      select * into v_row from public.close_out_due_appointments(r.tenant_id, p_at);
      v_total := v_total + coalesce(v_row.marked_showed, 0) + coalesce(v_row.marked_pending, 0);
    exception when others then
      raise warning 'appointment close-out failed for tenant %: %', r.tenant_id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$function$;

revoke all on function public.run_appointment_close_out(timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.run_appointment_close_out(timestamptz) to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- cron.schedule with an existing job name replaces that job, so re-running is safe.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20260929202000: pg_cron is not installed, the appointment jobs are not scheduled';
    return;
  end if;
  perform cron.schedule('appointment-in-app-reminders', '* * * * *',
    $cron$select public.run_appointment_in_app_reminders(now(), 200)$cron$);
  perform cron.schedule('appointment-close-out', '*/5 * * * *',
    $cron$select public.run_appointment_close_out(now())$cron$);
  perform cron.schedule('appointment-jobs-log-cleanup', '41 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname in ('appointment-in-app-reminders', 'appointment-close-out'))
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_member record;
  v_lead record;
  v_appt uuid;
  v_status text;
  v_seen boolean;
  v_count integer;
  v_refused boolean;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929202000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select count(*) into v_count from pg_attribute
   where attrelid = 'public.tenant_appointments'::regclass and not attisdropped
     and attname in ('rescheduled_from', 'first_booked_at', 'in_app_reminded_at');
  if v_count <> 3 then
    raise exception 'tenant_appointments is missing a column from 20260929202000 (found % of 3)', v_count;
  end if;

  v_src := pg_get_functiondef('public.mark_appointment_outcome(uuid, uuid, uuid, text)'::regprocedure);
  if strpos(v_src, 'APPOINTMENT_NOT_YET_HELD') = 0 or strpos(v_src, '''confirmed'', ''showed'', ''no_show'', ''cancelled''') = 0 then
    raise exception 'mark_appointment_outcome lacks the confirmed step or the not-yet-held refusal';
  end if;
  v_src := pg_get_functiondef('public.reschedule_appointment(uuid, uuid, uuid, timestamp with time zone)'::regprocedure);
  if strpos(v_src, 'booked_by = coalesce(a.booked_by, booked_by)') = 0 or strpos(v_src, 'rescheduled_from = a.id') = 0
     or strpos(v_src, 'APPOINTMENT_NOT_YOURS') = 0 or strpos(v_src, 'rebooked_from') = 0 then
    raise exception 'reschedule_appointment does not credit the first booker, link the chain or guard a setter';
  end if;
  v_src := pg_get_functiondef('public.rebook_appointment(uuid, uuid, uuid, timestamp with time zone, uuid)'::regprocedure);
  if strpos(v_src, 'APPOINTMENT_NOT_YOURS') = 0 or strpos(v_src, 'APPOINTMENT_ALREADY_REBOOKED') = 0 then
    raise exception 'rebook_appointment lost a rule or the setter guard';
  end if;
  if strpos(pg_get_viewdef('public.tenant_setter_scorecard'::regclass, true), '<> ''rescheduled''') = 0 then
    raise exception 'tenant_setter_scorecard still counts rescheduled rows as bookings';
  end if;
  if strpos(pg_get_functiondef('public.setter_scorecard_for_agent(uuid, uuid, timestamp with time zone)'::regprocedure), '<> ''rescheduled''') = 0 then
    raise exception 'setter_scorecard_for_agent still counts rescheduled rows as bookings';
  end if;
  if has_function_privilege('tenant_app', 'public.run_appointment_in_app_reminders(timestamptz, integer)', 'execute')
     or has_function_privilege('tenant_app', 'public.run_appointment_close_out(timestamptz)', 'execute') then
    raise exception 'the tenant plane can run an appointment job directly';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and (select count(*) from cron.job where jobname in ('appointment-in-app-reminders', 'appointment-close-out')) <> 2 then
    raise exception 'the appointment jobs are not scheduled';
  end if;

  -- Both jobs, run once for real and rolled back: a job whose body fails at run time fails every
  -- minute with nothing visible from the app (pg_cron failures are silent).
  begin
    perform public.run_appointment_in_app_reminders(now(), 50);
    perform public.run_appointment_close_out(now());
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- Behaviour, built and rolled back: an accepted owner or producer and one of their tenant's leads.
  select tu.tenant_id, tu.user_id into v_member
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer') and u.status::text = 'active'
   order by tu.tenant_id, tu.user_id
   limit 1;
  if v_member.user_id is null then
    raise notice '20260929202000: behaviour checks skipped, no active owner or producer';
    return;
  end if;
  select l.id into v_lead from public.agent_leads l where l.tenant_id = v_member.tenant_id limit 1;
  if v_lead.id is null then
    raise notice '20260929202000: behaviour checks skipped, the member''s tenant has no lead';
    return;
  end if;

  begin
    -- A slot far enough ahead that nothing else holds it, and inside the reminder window check below
    -- only when moved. Inserted directly: the booking rules are book_appointment's, tested elsewhere.
    insert into public.tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes, customer_timezone, status, seat)
    values
      (v_member.tenant_id, v_lead.id, v_member.user_id, v_member.user_id,
       date_trunc('minute', now()) + interval '731 days 7 minutes', 30, 'America/New_York', 'booked', 2)
    returning id into v_appt;

    -- 'showed' on an appointment two years away is refused.
    v_refused := false;
    begin
      perform public.mark_appointment_outcome(v_member.tenant_id, v_appt, v_member.user_id, 'showed');
    exception when others then
      v_refused := sqlerrm like 'APPOINTMENT_NOT_YET_HELD%';
    end;
    if not v_refused then raise exception 'mark_appointment_outcome accepted showed on a future appointment'; end if;

    -- booked -> confirmed
    perform public.mark_appointment_outcome(v_member.tenant_id, v_appt, v_member.user_id, 'confirmed');
    select status into v_status from public.tenant_appointments where id = v_appt;
    if v_status <> 'confirmed' then raise exception 'confirming left the appointment %', v_status; end if;

    -- 'rescheduled' is no longer an outcome.
    v_refused := false;
    begin
      perform public.mark_appointment_outcome(v_member.tenant_id, v_appt, v_member.user_id, 'rescheduled');
    exception when others then
      v_refused := sqlerrm like 'APPOINTMENT_OUTCOME_UNKNOWN%';
    end;
    if not v_refused then raise exception 'mark_appointment_outcome still accepts rescheduled'; end if;

    -- The in-app reminder: move it inside the window and run the job.
    update public.tenant_appointments set starts_at_utc = now() + interval '20 minutes' where id = v_appt;
    perform public.run_appointment_in_app_reminders(now(), 1000);
    select in_app_reminded_at is not null into v_seen from public.tenant_appointments where id = v_appt;
    if not v_seen then raise exception 'run_appointment_in_app_reminders did not remind a confirmed appointment 20 minutes out'; end if;
    if not exists (select 1 from public.agent_notifications n
                    where n.tenant_id = v_member.tenant_id and n.recipient_user_id = v_member.user_id
                      and n.source_key = 'appointment-reminder:' || v_appt::text || ':agent:' || lower(v_member.user_id::text)) then
      raise exception 'the in-app reminder wrote no notification';
    end if;

    -- The roster lists a member with no working hours.
    delete from public.tenant_agent_availability where tenant_id = v_member.tenant_id and user_id = v_member.user_id;
    select exists (select 1 from public.tenant_member_roster r
                    where r.tenant_id = v_member.tenant_id and r.user_id = v_member.user_id and r.on_shift_now is null)
      into v_seen;
    if not v_seen then raise exception 'tenant_member_roster drops a member who has no working hours'; end if;

    raise exception using errcode = 'P0099';
  exception
    when sqlstate 'P0099' then null;
    when exclusion_violation then
      raise notice '20260929202000: behaviour checks skipped, the test slot was taken';
  end;
end $$;
