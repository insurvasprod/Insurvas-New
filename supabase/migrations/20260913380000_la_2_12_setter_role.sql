-- ---------------------------------------------------------------------------
-- LA-2.12 · The setter role, and the number that says whether a setter is worth paying
--
-- The task is explicit about the thing most likely to go wrong here:
--
--   "Same shape as the buffer agent role in LA-1.14 — SHARE the permission model, do not invent a
--    second one."
--
-- So `setter` is a fifth value on `tenant_user_role`, and every gate that already exists keeps
-- deciding. It is not a flag on tenant_users, not a separate setters table, and not a parallel
-- permission map. The practical consequence is the one that matters: because every route lists the
-- roles it admits, a role that is new is admitted nowhere until somebody names it. Deny by default
-- falls out of the existing design rather than being added on top of it.
--
-- ON THE ENUM AND THE TRANSACTION. `alter type ... add value` may run inside a transaction, but the
-- new label may not be USED in that same transaction. Everything below therefore compares
-- `role::text = 'setter'` rather than casting a literal to the enum. That is not a stylistic
-- choice; the enum-literal form fails with 55P04 unsafe_use_of_new_value_of_enum_type on first
-- apply and then succeeds on replay, which is the worst possible failure mode for a migration.
--
-- ON `showed`. The status vocabulary from LA-2.11 already carries `showed` and `no_show`. That was
-- not accidental: the whole argument of this task is that booked-versus-showed is the number that
-- separates a good setter from an expensive one, and a show rate is only worth reading if the
-- appointment outcome is recorded by the person who kept the appointment rather than by the person
-- who booked it. Nothing here lets a setter write those two statuses.
-- ---------------------------------------------------------------------------

alter type public.tenant_user_role add value if not exists 'setter';

-- ── the outcome a setter cannot write ──────────────────────────────────────
--
-- `showed` / `no_show` are the licensed agent's to record. `mark_appointment_outcome` is the only
-- path that writes them, and it refuses a caller whose membership role is setter — server-side,
-- because "show rate computed from actual outcomes, not self-reported" is worthless if the person
-- being measured can write the measurement.
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
begin
  if p_outcome not in ('showed', 'no_show', 'cancelled') then
    raise exception 'APPOINTMENT_OUTCOME_UNKNOWN';
  end if;

  select tu.role::text into v_role
    from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;

  if v_role is null then
    raise exception 'ACTOR_NOT_A_MEMBER';
  end if;
  if v_role = 'setter' then
    raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
  end if;

  update tenant_appointments
     set status = p_outcome, updated_at = now()
   where id = p_appointment_id
     and tenant_id = p_tenant_id
     and status in ('booked', 'confirmed');

  if not found then
    raise exception 'APPOINTMENT_NOT_ACTIVE';
  end if;
end;
$function$;

revoke all on function public.mark_appointment_outcome(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_appointment_outcome(uuid, uuid, uuid, text) to tenant_app, service_role;

-- ── Ray is told, in the same transaction as the booking ────────────────────
--
-- The notification is written by `book_appointment` itself rather than by the service that calls
-- it. A booking that succeeded while the notification failed is the exact shape of the complaint
-- this task exists to prevent — an appointment nobody knew about. `source_key` makes the insert
-- idempotent per appointment, matching how every other agent notification in LA-1.25 is keyed.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';

  if v_src is null then
    raise exception 'book_appointment does not exist; LA-2.11 has not been applied';
  end if;

  if v_src ~ 'agent_notifications' then
    raise notice 'book_appointment already notifies';
    return;
  end if;

  -- The function ends by returning the new appointment id. The notify goes immediately before the
  -- return so it is inside the same transaction as the insert and the exclusion-constraint check.
  v_new := replace(
    v_src,
    E'  return query select v_id, p_starts_at_utc, v_minutes,',
    E'  insert into agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)\n'
    || E'  select p_tenant_id, p_agent_user_id, ''appointment_booked'',\n'
    || E'         ''New appointment booked'',\n'
    || E'         coalesce(nullif(btrim(p_notes), ''''), ''No notes from the setter.''),\n'
    || E'         ''/app/calendar?appointment='' || v_id::text,\n'
    || E'         ''appointment_booked:'' || v_id::text\n'
    || E'  where p_agent_user_id is not null and p_agent_user_id <> coalesce(p_booked_by, p_agent_user_id)\n'
    || E'  on conflict (tenant_id, recipient_user_id, source_key) do nothing;\n'
    || E'\n  return query select v_id, p_starts_at_utc, v_minutes,'
  );

  if v_new = v_src then
    raise exception 'book_appointment does not end the way this migration expects; the notify could not be placed';
  end if;

  execute v_new;
  raise notice 'book_appointment now notifies the agent';
end $$;

-- ── the scorecard, computed from what happened ─────────────────────────────
--
-- Per setter, per local day: dials · contacts · booked · showed · sold.
--
-- Each column names a different table on purpose, because each is a different kind of evidence and
-- the whole point of the task is that they can disagree:
--
--   dials     tenant_call_attempts   the setter pressed the button
--   contacts  the disposition        a human was on the other end
--   booked    tenant_appointments    the setter put it in the diary
--   showed    the appointment status written by the licensed agent, not by the setter
--   sold      an application-submitted attempt on that lead AFTER the appointment started
--
-- `sold` is deliberately not a column anybody sets. An appointment marked sold by hand is a claim;
-- an application submitted on that lead after the appointment began is a fact, and the dialer
-- already records it as a disposition.
create or replace view public.tenant_setter_scorecard as
with attempts as (
  select ca.tenant_id,
         ca.agent_id as user_id,
         ca.attempted_at,
         ca.disposition
    from tenant_call_attempts ca
   where ca.agent_id is not null
),
dials as (
  select a.tenant_id, a.user_id, date_trunc('day', a.attempted_at) as day,
         count(*) as dials,
         -- A contact is a call where somebody answered. Everything in this list is a call where
         -- nobody did, so a disposition nobody has invented yet counts as a contact rather than
         -- being silently dropped from the denominator's numerator.
         count(*) filter (
           where a.disposition is not null
             and a.disposition not in ('no_answer', 'voicemail', 'busy', 'call_dropped',
                                       'disconnected', 'wrong_number')
         ) as contacts
    from attempts a
   group by 1, 2, 3
),
booked as (
  select ap.tenant_id, ap.booked_by as user_id, date_trunc('day', ap.created_at) as day,
         count(*) as booked,
         count(*) filter (where ap.status = 'showed') as showed,
         count(*) filter (where ap.status = 'no_show') as no_show,
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
       coalesce(b.sold, 0) as sold,
       -- Null rather than zero when nothing has been decided yet: a setter with three appointments
       -- none of which has happened has no show rate, and printing 0% would read as a bad setter.
       case when coalesce(b.showed, 0) + coalesce(b.no_show, 0) > 0
            then round(100.0 * b.showed / (b.showed + b.no_show), 1) end as show_rate_pct,
       case when coalesce(d.contacts, 0) > 0
            then round(100.0 * coalesce(b.booked, 0) / d.contacts, 1) end as book_per_contact_pct
  from dials d
  full outer join booked b
    on b.tenant_id = d.tenant_id and b.user_id = d.user_id and b.day = d.day;

alter view public.tenant_setter_scorecard set (security_invoker = on);
revoke all on public.tenant_setter_scorecard from anon, authenticated, public;
grant select on public.tenant_setter_scorecard to tenant_app, service_role;

-- ── the roster, in the setter's own time ───────────────────────────────────
--
-- "Setters are often in another timezone entirely." The availability row from LA-2.11 already
-- carries the member's own zone, so the roster is a read of it rather than a second place to store
-- a timezone that can drift from the first.
--
-- `on_shift_now` is computed in that member's zone, not in the tenant's: 09:00-17:00 in Manila is a
-- different eight hours of UTC every time the Philippines or the reader changes clocks, and
-- comparing local wall-clock times is the only form of the question that stays true.
create or replace view public.tenant_member_roster as
select tu.tenant_id,
       tu.user_id,
       tu.role::text as role,
       av.timezone,
       (now() at time zone av.timezone) as local_time,
       to_char(now() at time zone av.timezone, 'Dy HH24:MI') as local_label,
       av.start_time,
       av.end_time,
       (
         extract(dow from (now() at time zone av.timezone))::smallint = av.weekday
         and (now() at time zone av.timezone)::time >= av.start_time
         and (now() at time zone av.timezone)::time < av.end_time
       ) as on_shift_now
  from tenant_users tu
  join tenant_agent_availability av
    on av.tenant_id = tu.tenant_id and av.user_id = tu.user_id
 where tu.accepted_at is not null;

alter view public.tenant_member_roster set (security_invoker = on);
revoke all on public.tenant_member_roster from anon, authenticated, public;
grant select on public.tenant_member_roster to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_labels text[];
begin
  select array_agg(e.enumlabel order by e.enumsortorder) into v_labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid
   where t.typname = 'tenant_user_role';

  if not ('setter' = any(v_labels)) then
    raise exception 'setter did not reach tenant_user_role (got %)', v_labels;
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'book_appointment'
         and pg_get_functiondef(p.oid) ~ 'agent_notifications') <> 1 then
    raise exception 'book_appointment does not notify';
  end if;

  perform 1 from public.tenant_setter_scorecard limit 1;
  perform 1 from public.tenant_member_roster limit 1;

  raise notice 'LA-2.12: setter role, outcome guard, booking notification, scorecard and roster in place';
end $$;
