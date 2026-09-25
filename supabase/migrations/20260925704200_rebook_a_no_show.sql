-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · rebook a no-show
--
-- The board puts two actions on a no-show: "Call her now" and "Rebook". There was no way to do the
-- second: `reschedule_appointment` only moves a live (booked / confirmed) appointment, and a
-- no-show is closed. The only route was to book the lead again from scratch, which lost the link
-- between the two appointments.
--
-- USER DECISION 2026-09-25:
--   * the person who rebooks is `booked_by` on the new appointment (the scorecard credits them);
--   * the no-show STAYS a no-show and keeps counting against whoever booked it. Rebooking is a new
--     appointment, not an amendment of the old one — otherwise a setter could launder a no-show
--     into a show by rebooking it.
--
-- What this adds:
--   tenant_appointments.rebooked_from   the no-show this appointment was rebooked from.
--   rebook_appointment(...)             books through book_appointment (every rule, the race, the
--                                       caps) and links the new row to the no-show. Refuses a row
--                                       that is not a no-show (APPOINTMENT_NOT_A_NO_SHOW) and a
--                                       no-show that already has a live rebooking
--                                       (APPOINTMENT_ALREADY_REBOOKED). The no-show is locked while
--                                       this runs, so two people rebooking it at once get one
--                                       winner.
--   reschedule_appointment(...)         reproduced from 20260913370000 (its latest definition),
--                                       unchanged except that a rebooked appointment keeps its
--                                       `rebooked_from` when it is moved, so the chain survives a
--                                       reschedule. [704200] marks the addition.
-- ---------------------------------------------------------------------------

alter table public.tenant_appointments
  add column if not exists rebooked_from uuid references public.tenant_appointments(id) on delete set null;

create index if not exists tenant_appointments_rebooked_from_idx
  on public.tenant_appointments (rebooked_from)
  where rebooked_from is not null;

-- ── rebook ─────────────────────────────────────────────────────────────────
create or replace function public.rebook_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz,
  p_agent_user_id uuid default null
)
returns table(appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_result record;
begin
  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status <> 'no_show' then raise exception 'APPOINTMENT_NOT_A_NO_SHOW'; end if;

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
  -- The actor is `booked_by`; the duration is the agent's current policy, not the old slot's.
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

-- ── reschedule keeps the chain ─────────────────────────────────────────────
create or replace function public.reschedule_appointment(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_actor uuid,
  p_starts_at_utc timestamptz
)
returns table(appointment_id uuid, starts_at_utc timestamptz, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_new uuid;
  v_result record;
begin
  select * into a from tenant_appointments
   where id = p_appointment_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'APPOINTMENT_NOT_ACTIVE'; end if;

  -- The old row leaves the constraint's scope FIRST, in the same transaction, so the new time may
  -- legitimately be the old one and a reschedule can never collide with itself. If the booking
  -- below fails, this rolls back with it and the original slot is still held.
  update tenant_appointments set status = 'rescheduled', updated_at = now() where id = a.id;

  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, a.agent_user_id, p_actor, p_starts_at_utc, a.notes, a.duration_minutes);
  v_new := v_result.appointment_id;

  -- [704200] A rebooked appointment that is moved is still the rebooking of the same no-show.
  if a.rebooked_from is not null then
    update tenant_appointments set rebooked_from = a.rebooked_from where id = v_new;
  end if;

  return query select v_new, p_starts_at_utc, 'Rescheduled; the previous slot is free.'::text;
end;
$function$;

revoke all on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_appointments' and column_name = 'rebooked_from'
  ) then
    raise exception 'tenant_appointments.rebooked_from was not added';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebook_appointment';
  if v_def is null or v_def !~ 'APPOINTMENT_NOT_A_NO_SHOW' or v_def !~ 'APPOINTMENT_ALREADY_REBOOKED'
     or v_def !~ 'book_appointment\(' or v_def !~ 'for update' then
    raise exception 'rebook_appointment does not book through book_appointment under a lock';
  end if;
  -- The no-show itself is never rewritten.
  if v_def ~ 'set status' then
    raise exception 'rebook_appointment changes the no-show it rebooks';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reschedule_appointment';
  if v_def !~ 'rebooked_from' or v_def !~ 'APPOINTMENT_NOT_ACTIVE' then
    raise exception 'reschedule_appointment lost a rule or does not keep rebooked_from';
  end if;

  if has_function_privilege('tenant_app', 'public.rebook_appointment(uuid, uuid, uuid, timestamptz, uuid)', 'execute') then
    raise exception 'the tenant plane can call rebook_appointment directly';
  end if;
end $$;
