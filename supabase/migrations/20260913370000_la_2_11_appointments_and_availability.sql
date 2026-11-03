-- ---------------------------------------------------------------------------
-- LA-2.11 · The calendar, and the constraint that makes double-booking impossible
--
-- "The current module has no calendar at all — no availability model, no slots, no reminders, no
-- show-rate beyond a single field." True of the tenant plane. The organizations plane has
-- `agent_availability`, `agent_blocks`, `agent_appointments`, `outbound_appointments` and
-- `appointment_reminder_events`, all organization_id-keyed and unreachable from here — the same
-- shape as every other task in this module.
--
-- NAMING. The spec calls the table `appointments`, and `public.appointments` already exists on the
-- tenant plane as LA-0.5's **carrier appointment vault** — an agent's licensing appointments with a
-- carrier, with no lead_id. That collision already cost something: LA-2.8's first draft joined it
-- for tier 3, which compiled and would have served leads on the strength of an unrelated insurance
-- record. So this is `tenant_appointments`, and tier 3 is wired to it at the end of this file.
--
-- THE RULE, and why it is an exclusion constraint:
--
--   "Double-booking is impossible, not discouraged. Two setters booking the same slot at the same
--    moment is a race, and it must be resolved by the database with a constraint — not by a
--    client-side check on a stale slot list."
--
-- A unique index on (agent, start) would not do it: appointments have length, so 14:00-14:30 and
-- 14:15-14:45 collide without sharing a start. An overlap needs a range and a GiST exclusion, which
-- is the only construct that resolves the race in the database rather than in whoever checked last.
-- ---------------------------------------------------------------------------

create extension if not exists btree_gist;

-- ── availability ───────────────────────────────────────────────────────────
create table if not exists public.tenant_agent_availability (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- 0 = Sunday, matching extract(dow).
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  -- The AGENT's zone, not the customer's. These are his working hours.
  timezone text not null,
  created_at timestamptz not null default now(),
  constraint tenant_agent_availability_sane check (start_time < end_time),
  unique (tenant_id, user_id, weekday, start_time)
);

create table if not exists public.tenant_agent_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint tenant_agent_blocks_sane check (starts_at < ends_at)
);

create index if not exists tenant_agent_blocks_lookup_idx
  on public.tenant_agent_blocks (tenant_id, user_id, starts_at);

-- Per-agent booking policy. Separate from availability because it is one row per agent, not one
-- per weekday, and because "how many can be booked" is a different question from "when".
create table if not exists public.tenant_agent_booking_policy (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  appointment_minutes integer not null default 30 check (appointment_minutes between 5 and 480),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  -- "A setter incentivised on volume will fill every hour otherwise."
  max_per_day integer not null default 8 check (max_per_day between 1 and 50),
  primary key (tenant_id, user_id)
);

-- ── appointments ───────────────────────────────────────────────────────────
create table if not exists public.tenant_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  agent_user_id uuid not null references public.users(id) on delete cascade,
  -- Ray, or which setter. The distinction is the point of the field.
  booked_by uuid references public.users(id) on delete set null,
  starts_at_utc timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  -- Recorded on the appointment rather than re-derived from the lead, because the lead's state can
  -- be corrected later and the appointment was booked against what was known at the time.
  customer_timezone text not null,
  status text not null default 'booked'
    check (status in ('booked', 'confirmed', 'showed', 'no_show', 'cancelled', 'rescheduled')),
  -- "What was discussed, what to lead with." Carried into the queue when the appointment is due.
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The end, derived from the start and the duration, kept by a trigger rather than a generated
  -- column: `timestamptz + interval` is STABLE rather than IMMUTABLE (adding months or days depends
  -- on the session's TimeZone), and a generated column may only use immutable expressions. The
  -- trigger below gives the same guarantee — nothing can write a row whose end disagrees with its
  -- own start and duration — without pretending the arithmetic is something it is not.
  ends_at_utc timestamptz not null default now()
);

create or replace function public.stamp_appointment_end()
returns trigger
language plpgsql
as $function$
begin
  new.ends_at_utc := new.starts_at_utc + make_interval(mins => new.duration_minutes);
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists tenant_appointments_end on public.tenant_appointments;
create trigger tenant_appointments_end
  before insert or update of starts_at_utc, duration_minutes on public.tenant_appointments
  for each row execute function public.stamp_appointment_end();

-- THE CONSTRAINT. Two setters booking the same agent for overlapping times: one commits, the other
-- gets 23P01 and is told it went. Not a check, not a client-side slot list — the database refuses.
--
-- Scoped to live appointments only: a cancelled or rescheduled one must not block its own
-- replacement, which is what makes "rescheduling frees the old slot atomically" possible in a
-- single transaction.
alter table public.tenant_appointments
  drop constraint if exists tenant_appointments_no_double_booking;
alter table public.tenant_appointments
  add constraint tenant_appointments_no_double_booking
  exclude using gist (
    tenant_id with =,
    agent_user_id with =,
    tstzrange(starts_at_utc, ends_at_utc, '[)') with &&
  ) where (status in ('booked', 'confirmed'));

create index if not exists tenant_appointments_due_idx
  on public.tenant_appointments (tenant_id, starts_at_utc)
  where status in ('booked', 'confirmed');
create index if not exists tenant_appointments_lead_idx
  on public.tenant_appointments (tenant_id, lead_id);

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
  v_zone text;
  v_state text;
  v_campaign uuid;
  v_customer_zone text;
  v_local timestamp;
  v_dow smallint;
  v_id uuid;
  v_booked_that_day integer;
begin
  if p_starts_at_utc <= now() then
    raise exception 'APPOINTMENT_IN_THE_PAST';
  end if;

  select * into v_policy from tenant_agent_booking_policy
   where tenant_id = p_tenant_id and user_id = p_agent_user_id;
  v_minutes := coalesce(p_duration_minutes, v_policy.appointment_minutes, 30);

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

    if exists (
      select 1 from tenant_agent_blocks b
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and tstzrange(b.starts_at, b.ends_at, '[)')
             && tstzrange(p_starts_at_utc, p_starts_at_utc + make_interval(mins => v_minutes), '[)')
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

  -- The overlap itself is NOT checked here. The exclusion constraint decides it, which is the only
  -- way two setters racing on the same slot get one winner rather than two rows. A check here
  -- would read a slot list that is already stale by the time the insert runs.
  begin
    insert into tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
       customer_timezone, notes)
    values
      (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
       v_customer_zone, nullif(btrim(p_notes), ''))
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_SLOT_TAKEN';
  end;

  return query select v_id, p_starts_at_utc, v_minutes,
    format('Booked for %s in the customer''s %s.', p_starts_at_utc at time zone v_customer_zone, v_customer_zone);
end;
$function$;

-- ── rescheduling frees the old slot atomically ─────────────────────────────
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

  return query select v_new, p_starts_at_utc, 'Rescheduled; the previous slot is free.'::text;
end;
$function$;

-- ── tier 3, finally ────────────────────────────────────────────────────────
--
-- LA-2.8 left tier 3 empty because `appointments` was the carrier vault and there was nothing else
-- to join. There is now. The setter's notes travel with it, which is the point of the tier: an
-- appointment served without what the setter discussed is a cold call with a time attached.
-- Dropped and recreated rather than replaced: the return type gains `appointment_notes`, and
-- `create or replace` cannot change a function's OUT parameters.
drop function if exists public.serve_next_lead(uuid, uuid);

create function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(work_item_id uuid, lead_id uuid, tier integer, tier_name text, locked_until timestamptz, appointment_notes text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_notes text;
begin
  update lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
   where q.tenant_id = p_tenant_id
     and q.status = 'claimed'
     and q.locked_until is not null
     and q.locked_until < v_now;

  with eligible as (
    select q.id as qid,
           q.lead_id as lid,
           case
             when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
             when exists (select 1 from tenant_callbacks cb
                           where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                             and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
             -- 3 APPOINTMENT: a setter booked this one, and it is due.
             when exists (select 1 from tenant_appointments ap
                           where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                             and ap.status in ('booked', 'confirmed')
                             and ap.starts_at_utc <= v_now
                             and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
             when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                  and not exists (
                    select 1 from tenant_call_attempts ca
                     where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                       and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                  ) then 4
             when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
             when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
             else null
           end as priority,
           coalesce(c.mixing_weight, 1) as weight,
           l.posted_at as posted_at,
           q.queued_at as queued_at
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
      left join tenant_campaigns c on c.id = l.campaign_id
     where q.tenant_id = p_tenant_id
       and q.status = 'unclaimed'
       and (q.locked_until is null or q.locked_until < v_now)
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select s.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') s)
       and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
       and l.lead_state <> 'exhausted'
  )
  select e.qid, e.lid, e.priority
    into v_qid, v_lead, v_priority
    from eligible e
   where e.priority is not null
   order by e.priority,
            -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
            coalesce(e.posted_at, e.queued_at)
   limit 1;

  if v_qid is null then
    return;
  end if;

  update lead_queue q
     set status = 'claimed',
         claimed_by = p_agent_user_id,
         owner_user_id = p_agent_user_id,
         claimed_at = v_now,
         locked_until = v_now + make_interval(mins => v_lock_minutes),
         updated_at = v_now
   where q.id = v_qid and q.status = 'unclaimed';

  if not found then
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_lead and l.tenant_id = p_tenant_id;

  if v_priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_lead
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes;
end;
$function$;

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.tenant_agent_availability enable row level security;
alter table public.tenant_agent_blocks enable row level security;
alter table public.tenant_agent_booking_policy enable row level security;
alter table public.tenant_appointments enable row level security;

drop policy if exists tenant_agent_availability_scoped on public.tenant_agent_availability;
create policy tenant_agent_availability_scoped on public.tenant_agent_availability for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_agent_blocks_scoped on public.tenant_agent_blocks;
create policy tenant_agent_blocks_scoped on public.tenant_agent_blocks for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_agent_booking_policy_scoped on public.tenant_agent_booking_policy;
create policy tenant_agent_booking_policy_scoped on public.tenant_agent_booking_policy for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_appointments_scoped on public.tenant_appointments;
create policy tenant_appointments_scoped on public.tenant_appointments for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_agent_availability, public.tenant_agent_blocks,
               public.tenant_agent_booking_policy, public.tenant_appointments
  from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_agent_availability, public.tenant_agent_blocks,
      public.tenant_agent_booking_policy to tenant_app;
grant select on public.tenant_appointments to tenant_app;
grant select, insert, update, delete on public.tenant_agent_availability, public.tenant_agent_blocks,
      public.tenant_agent_booking_policy, public.tenant_appointments to service_role;

revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) to service_role;
revoke all on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_appointment(uuid, uuid, uuid, timestamptz) to service_role;
revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.serve_next_lead(uuid, uuid) to service_role;
