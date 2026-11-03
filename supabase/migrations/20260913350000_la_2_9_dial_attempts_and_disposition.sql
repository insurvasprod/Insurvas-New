-- ---------------------------------------------------------------------------
-- LA-2.9 · The dial attempt, and the disposition that must not leave a lead in limbo
--
-- This closes LA-2.8's two carried-forward items as well: recording the attempt with its slot, and
-- stamping the dial.
--
-- What exists on the tenant plane today: `app/app/(shell)/dialer/page.tsx` renders
-- `DialerPreflight`, a 63-line form that checks one typed phone number against the DNC vendors.
-- That is LA-1.5's preflight, not LA-2.9's dialer — there is no lead, no local time, no attempt
-- history and no disposition buttons.
--
-- Criterion 5 — "no metric labelled talk time is displayed" — PASSES BY ABSENCE, and it is worth
-- writing down why rather than ticking it. `call_duration_seconds` exists on `lead_dispositions`
-- and `outbound_dispositions`, both organizations-plane, and **no application code reads either**.
-- The only duration the agent app renders is `durationSince(item.startedAt)` in agent-floor.tsx,
-- which is a live timer on an open call computed in the browser, not a stored figure and not
-- labelled talk time. So the wrong number the task warns about is not on screen — but the columns
-- that would produce it are still there, and anyone wiring a report from them would reintroduce it.
--
-- THE SEAM. `provider_call_id` is nullable from the start. Click-to-call is a `tel:` link into
-- whatever softphone the agent already uses; there is no provider and no call id today. Leaving the
-- column out until one arrives would mean migrating a table that by then has history in it.
-- ---------------------------------------------------------------------------

alter table public.tenant_call_attempts
  -- The seam. Null means "this was a tel: link and nobody can tell us what happened".
  add column if not exists provider_call_id text,
  -- The zero-click check. "An agent can record an outcome for a call that never happened" — this
  -- is the only integrity check available without telephony, so it is kept.
  add column if not exists dial_clicked_at timestamptz,
  add column if not exists work_item_id uuid references public.lead_queue(id) on delete set null;

-- Dispositions recorded against a call nobody placed. Not blocked — an agent who dials from a desk
-- phone is doing nothing wrong — but visible, which is the whole point.
create or replace view public.dispositions_without_a_click as
select a.tenant_id,
       a.id as attempt_id,
       a.lead_id,
       a.agent_id,
       a.attempted_at,
       a.disposition,
       a.slot
  from public.tenant_call_attempts a
 where a.disposition is not null
   and a.dial_clicked_at is null;

alter view public.dispositions_without_a_click set (security_invoker = on);
revoke all on public.dispositions_without_a_click from anon, authenticated, public;
grant select on public.dispositions_without_a_click to tenant_app, service_role;

-- ── the cadence, in SQL, because the disposition has to apply it ───────────
--
-- Same enforce/explain split as the calling window: this decides, lib/cadence/engine.ts explains.
-- The two read the same `tenant_cadence_rules`, and fall back to the same default table when a
-- tenant has defined none.
create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  v_next := v_made + 1;

  -- The ceiling terminates rather than schedules. Returning a date far in the future would have
  -- been the easy way to say "stop" and the wrong one: a queue that only checks whether the timer
  -- has elapsed would serve it eventually.
  if v_made >= v_ceiling - 1 then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A disposition-specific row beats the catch-all, and a campaign row beats the tenant default.
  -- "No-answer and voicemail should not behave identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (r.campaign_id = v_campaign or r.campaign_id is null)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when the tenant has defined nothing.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
  end if;

  -- Slots this lead has already failed in.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select s into v_slot from unnest(v_available) s where not (s = any(v_tried)) limit 1;
  end if;

  -- Everything tried: still call, just without a fresh hypothesis. The criterion is "never retried
  -- into a slot it has already failed in WHILE AN UNUSED SLOT REMAINS".
  if v_slot is null then v_slot := v_tried[1]; end if;

  return query select p_at + v_delay, v_next, v_slot, false;
end;
$function$;

-- ── one disposition, one outcome, never limbo ──────────────────────────────
--
-- "Every disposition schedules or terminates the lead — none leaves it in limbo." That is the
-- criterion, and it is why this is one function rather than a service that does three writes and
-- hopes. Every branch below ends with the lead in a state the queue understands: a date to come
-- back to, or a terminal state that stops it being served.
create or replace function public.complete_dial_disposition(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_agent_user_id uuid,
  p_disposition text,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns table(lead_state text, next_dial_after timestamptz, next_slot text, suppressed boolean, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead uuid;
  v_phone text;
  v_state text;
  v_slot text;
  v_now timestamptz := clock_timestamp();
  v_sched record;
  v_new_state text;
  v_suppressed boolean := false;
  v_reason text;
  v_attempts integer;
begin
  select q.lead_id into v_lead
    from lead_queue q
   where q.id = p_work_item_id and q.tenant_id = p_tenant_id
   for update;
  if v_lead is null then
    raise exception 'WORK_ITEM_NOT_FOUND';
  end if;

  select l.values->>'phone', l.values->>'state', coalesce(l.attempts_made, 0)
    into v_phone, v_state, v_attempts
    from agent_leads l where l.id = v_lead and l.tenant_id = p_tenant_id for update;

  -- The slot is the one the call actually happened in, recorded so rotation has evidence to work
  -- from. Without this row the next attempt has no idea what has been tried.
  v_slot := coalesce(current_slot_for_state(v_state, v_now), 'late_morning');

  insert into tenant_call_attempts
    (tenant_id, lead_id, work_item_id, attempt_number, slot, attempted_at, disposition, agent_id,
     dial_clicked_at, provider_call_id)
  values
    (p_tenant_id, v_lead, p_work_item_id, v_attempts + 1, v_slot, v_now, p_disposition, p_agent_user_id,
     p_dial_clicked_at, p_provider_call_id);

  update agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead;
  v_attempts := v_attempts + 1;

  if p_disposition = 'do_not_call' then
    -- Permanently, to the list the disposition path already writes (LA-2.3).
    if v_phone is not null then
      perform suppress_phone(p_tenant_id, v_phone, 'internal',
                             'Agent recorded do not call on the dialer', 'disposition', p_agent_user_id);
      v_suppressed := true;
    end if;
    v_new_state := 'closed';
    v_reason := 'Added to the do-not-call list permanently. This lead will never be served again.';

  elsif p_disposition in ('wrong_number', 'disconnected') then
    -- Flagged for a vendor credit claim (LA-2.19). Closed either way: there is nobody to call.
    v_new_state := 'closed';
    v_reason := 'Closed and flagged for a vendor credit claim.';

  elsif p_disposition in ('not_interested', 'did_not_qualify', 'application_submitted',
                          'sent_to_underwriting', 'no_payment_method') then
    v_new_state := 'closed';
    v_reason := 'Closed. No further attempts.';

  elsif p_disposition = 'callback_scheduled' then
    -- The callback owns the timing; the cadence must not also schedule one or the lead is served
    -- twice for the same promise.
    v_new_state := 'working';
    v_reason := 'A callback is scheduled; the cadence does not apply.';

  else
    -- No answer, voicemail, call dropped, anything unrecognised: the cadence decides, and a
    -- disposition nobody anticipated still gets a next attempt rather than silence.
    select * into v_sched from schedule_next_attempt(p_tenant_id, v_lead, p_disposition, v_now);
    if v_sched.exhausted then
      v_new_state := 'exhausted';
      v_reason := format('Attempt %s reached the ceiling. Moved to nurture and no longer served.', v_attempts);
      update agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null
       where id = v_lead;
    else
      v_new_state := 'retry';
      v_reason := format('Attempt %s scheduled for %s in the %s slot.',
                         v_sched.attempt_number, to_char(v_sched.due_at, 'Dy DD Mon HH24:MI'),
                         replace(v_sched.slot, '_', ' '));
      update agent_leads
         set lead_state = 'retry', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot
       where id = v_lead;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update agent_leads
       set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null
     where id = v_lead;
  end if;

  -- The work item is released either way. A lead left `claimed` after a disposition is the limbo
  -- this criterion is about: nobody else can serve it and its own agent has moved on.
  update lead_queue
     set status = case when v_new_state = 'retry' then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = p_work_item_id and tenant_id = p_tenant_id;

  return query select v_new_state,
                      case when v_new_state = 'retry' then v_sched.due_at else null end,
                      case when v_new_state = 'retry' then v_sched.slot else null end,
                      v_suppressed,
                      v_reason;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to service_role;
revoke all on function public.complete_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;
