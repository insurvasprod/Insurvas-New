-- ---------------------------------------------------------------------------
-- LA-2.12 criterion 4, AMENDED · show rate is inferred, and its coverage is shown
--
-- I scored this criterion PASS last session against the wording on the task page:
--
--   "Show-rate per setter is computed from actual appointment outcomes, not self-reported"
--
-- The decision log supersedes that sentence, and it is dated after the task page. Decision 12
-- asks the question the criterion does not survive: the only person who knows whether someone
-- showed is Ray, after the call, and **people are being paid on this number**. If he forgets to
-- mark it, the setter's score is wrong.
--
-- The implementation shipped was the literal reading — a status only the licensed agent may write,
-- with nothing filled in when he does not write it. That is exactly the failure mode decision 12
-- identifies, so this replaces it. Three parts, all from the decision:
--
--   1. AUTOMATIC. Any recorded activity on that lead near the appointment slot marks it `showed`.
--      Ray dispositioning the call IS the marking. Most appointments need zero extra clicks.
--
--   2. PENDING. Anything with no activity becomes `pending` and appears in a close-out strip.
--      `pending` is an explicit state rather than an absence, which is what lets it be counted.
--
--   3. PENDING IS EXCLUDED, NEVER COUNTED AS A NO-SHOW. After three days it drops out of the show
--      rate entirely, and the scorecard reports COVERAGE beside the number.
--
-- The coverage figure is the part that matters most and looks least important:
--
--   "You cannot force a busy person to do admin. What you CAN do is make sure a missing mark never
--    silently becomes a penalty against someone's pay, and make it obvious when the number is
--    built on thin data."
--
-- A show rate of 62% from 31 of 38 appointments is a number to act on. The same 62% from 8 of 38
-- is not, and the screen must say so rather than leaving the reader to work it out.
-- ---------------------------------------------------------------------------

-- ── `pending` becomes a state ──────────────────────────────────────────────
do $$
begin
  alter table public.tenant_appointments drop constraint if exists tenant_appointments_status_check;
  alter table public.tenant_appointments add constraint tenant_appointments_status_check
    check (status in ('booked', 'confirmed', 'pending', 'showed', 'no_show', 'cancelled', 'rescheduled'));
end $$;

-- ── did anything happen on this lead, near the slot? ───────────────────────
--
-- The window is deliberately wider after than before: an appointment at 2pm that Ray works at 2:40
-- is the normal case, and one he prepared for at 1:30 is also real. A note written a week later is
-- not evidence that the customer turned up.
--
-- Every source here is work Ray already does. Nothing asks him to record anything new, which is
-- the entire point — a marking step he has to remember is a marking step that produces a wrong
-- number for somebody's pay.
create or replace function public.appointment_had_activity(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_starts_at_utc timestamptz
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from tenant_call_attempts ca
     where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id
       and ca.attempted_at between p_starts_at_utc - interval '1 hour' and p_starts_at_utc + interval '24 hours'
  ) or exists (
    -- `lead_notes` is one of the tables both lineages share, so the tenant filter is load-bearing
    -- rather than decorative. A deleted note is not evidence of anything.
    select 1 from lead_notes n
     where n.tenant_id = p_tenant_id and n.lead_id = p_lead_id
       and n.deleted_at is null
       and n.created_at between p_starts_at_utc - interval '1 hour' and p_starts_at_utc + interval '24 hours'
  ) or exists (
    -- An application started on this lead is the strongest evidence of all: nobody takes an
    -- application from somebody who did not turn up. LA-2.14 is what makes this readable.
    select 1 from tenant_application_cases ac
     where ac.tenant_id = p_tenant_id and ac.lead_id = p_lead_id
       and ac.opened_at between p_starts_at_utc - interval '1 hour' and p_starts_at_utc + interval '24 hours'
  ) or exists (
    select 1 from deal_flow d
     where d.tenant_id = p_tenant_id and d.lead_id = p_lead_id
       and d.updated_at between p_starts_at_utc and p_starts_at_utc + interval '24 hours'
       and d.status is distinct from 'partial'
  );
$function$;

revoke all on function public.appointment_had_activity(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.appointment_had_activity(uuid, uuid, timestamptz) to tenant_app, service_role;

-- ── the close-out pass ─────────────────────────────────────────────────────
--
-- Run on a schedule, or on demand when the dashboard loads its strip. Idempotent: an appointment
-- it has already resolved is not in scope the second time.
create or replace function public.close_out_due_appointments(p_tenant_id uuid, p_at timestamptz default now())
returns table(marked_showed integer, marked_pending integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_showed integer := 0;
  v_pending integer := 0;
begin
  -- Automatic first. An appointment with activity near its slot is a show, with no clicks.
  with resolved as (
    update tenant_appointments a
       set status = 'showed', updated_at = p_at
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.ends_at_utc <= p_at
       and appointment_had_activity(a.tenant_id, a.lead_id, a.starts_at_utc)
    returning 1
  )
  select count(*)::integer into v_showed from resolved;

  -- Everything else that is past goes to pending, where a human can see it. Not to no_show:
  -- "a missing mark never silently becomes a penalty against someone's pay."
  with parked as (
    update tenant_appointments a
       set status = 'pending', updated_at = p_at
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.ends_at_utc <= p_at
    returning 1
  )
  select count(*)::integer into v_pending from parked;

  return query select v_showed, v_pending;
end;
$function$;

revoke all on function public.close_out_due_appointments(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.close_out_due_appointments(uuid, timestamptz) to tenant_app, service_role;

-- ── the close-out strip ────────────────────────────────────────────────────
--
-- "Three appointments, three buttons each. Ten seconds." Only the ones still inside the three-day
-- window: after that they have dropped out of the show rate and asking about them is asking Ray to
-- do admin that no longer changes anything.
create or replace view public.tenant_appointment_close_out as
select a.tenant_id,
       a.id as appointment_id,
       a.lead_id,
       a.agent_user_id,
       a.booked_by,
       a.starts_at_utc,
       a.customer_timezone,
       a.notes,
       (a.starts_at_utc at time zone a.customer_timezone) as starts_at_local,
       (now() - a.starts_at_utc) as waiting_for
  from tenant_appointments a
 where a.status = 'pending'
   and a.starts_at_utc >= now() - interval '3 days';

alter view public.tenant_appointment_close_out set (security_invoker = on);
revoke all on public.tenant_appointment_close_out from anon, authenticated, public;
grant select on public.tenant_appointment_close_out to tenant_app, service_role;

-- ── the outcome, now reachable from pending ────────────────────────────────
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
  if p_outcome not in ('showed', 'no_show', 'cancelled', 'rescheduled') then
    raise exception 'APPOINTMENT_OUTCOME_UNKNOWN';
  end if;

  select tu.role::text into v_role
    from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;

  if v_role is null then
    raise exception 'ACTOR_NOT_A_MEMBER';
  end if;
  -- Unchanged, and it is the reason the number means anything: the person being measured does not
  -- write the measurement.
  if v_role = 'setter' then
    raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
  end if;

  update tenant_appointments
     set status = p_outcome, updated_at = now()
   where id = p_appointment_id
     and tenant_id = p_tenant_id
     and status in ('booked', 'confirmed', 'pending');

  if not found then
    raise exception 'APPOINTMENT_NOT_ACTIVE';
  end if;
end;
$function$;

revoke all on function public.mark_appointment_outcome(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_appointment_outcome(uuid, uuid, uuid, text) to tenant_app, service_role;

-- ── the scorecard, with coverage beside the number ─────────────────────────
-- Dropped rather than replaced: `create or replace view` refuses to change a column's name or
-- position (42P16), and `pending` and `never_closed_out` belong beside the counts they qualify
-- rather than appended at the end where nobody reading the row would connect them.
drop view if exists public.tenant_setter_scorecard;
create view public.tenant_setter_scorecard as
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
  select ap.tenant_id, ap.booked_by as user_id, date_trunc('day', ap.created_at) as day,
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
       -- The rate, over closed-out appointments only. Pending is excluded from both halves of the
       -- fraction, never counted as a no-show.
       case when coalesce(b.showed, 0) + coalesce(b.no_show, 0) > 0
            then round(100.0 * b.showed / (b.showed + b.no_show), 1) end as show_rate_pct,
       -- COVERAGE. "Show rate 62% -- based on 31 of 38 appointments closed out." Without this the
       -- reader cannot tell 62%-of-31 from 62%-of-8, and one of those is a pay decision.
       coalesce(b.showed, 0) + coalesce(b.no_show, 0) as closed_out,
       coalesce(b.booked, 0) - coalesce(b.upcoming, 0) as closeable,
       case when coalesce(b.booked, 0) - coalesce(b.upcoming, 0) > 0
            then round(100.0 * (coalesce(b.showed, 0) + coalesce(b.no_show, 0))
                       / (b.booked - b.upcoming), 1) end as coverage_pct,
       case when coalesce(d.contacts, 0) > 0
            then round(100.0 * coalesce(b.booked, 0) / d.contacts, 1) end as book_per_contact_pct
  from dials d
  full outer join booked b
    on b.tenant_id = d.tenant_id and b.user_id = d.user_id and b.day = d.day;

alter view public.tenant_setter_scorecard set (security_invoker = on);
revoke all on public.tenant_setter_scorecard from anon, authenticated, public;
grant select on public.tenant_setter_scorecard to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_appointments_status_check'
       and pg_get_constraintdef(oid) like '%pending%'
  ) then
    raise exception 'pending did not reach the appointment status vocabulary';
  end if;

  perform 1 from public.tenant_appointment_close_out limit 1;
  perform 1 from public.tenant_setter_scorecard limit 1;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_setter_scorecard'
       and column_name = 'coverage_pct'
  ) then
    raise exception 'the scorecard does not report coverage';
  end if;

  raise notice 'LA-2.12 c4 amended: activity infers a show, pending is explicit and excluded, coverage is reported';
end $$;
