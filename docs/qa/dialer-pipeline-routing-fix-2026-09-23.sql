-- LA-2 · a disposition recorded on the DIALER never reached its dedicated pipeline.
--
-- "Whatever the disposition outcome is, put it in the dedicated pipeline which is reserved for
-- specific cases, specific dispositions." `20260922220000` implemented that — in
-- `complete_disposition`, the wizard used from the lead workspace. The dialer has its own
-- function, `complete_existing_dial_disposition`, and it never read `stage_dispositions` at all.
--
-- Measured live 2026-09-23. Same disposition, two leads, two paths:
--
--     Hugo   wizard   not_interested -> pipeline c6f1cb62  stage "Previously Sold"
--     Clara  dialer   not_interested -> pipeline d792b8f6  stage "Form Lead"   (unmoved)
--
-- The dialer is the main outbound route, so the feature was missing from the path that matters
-- most — and it looked present, because the other path worked.
--
-- ── Only terminal dispositions move ────────────────────────────────────────
--
-- Decided 2026-09-23. The states this function settles on:
--
--     closed      do_not_call, wrong_number, disconnected, not_interested, did_not_qualify,
--                 application_submitted, sent_to_underwriting, no_payment_method
--     exhausted   the cadence ceiling was reached; the lead goes to nurture
--     working     callback_scheduled — a specific time the customer chose
--     retry       the cadence continues; back in the queue for the next attempt
--
-- `closed` and `exhausted` move: the lead has finished with the dialer. `retry` and `working`
-- do not, because both are still in flight.
--
-- `callback_scheduled` is the debatable one. It is mapped to "Needs Callback" and it is not on the
-- retry cadence — but the lead IS coming back, so it stays put under the rule as stated. Moving it
-- too is a one-word change to the `in` list below.
--
-- Derived from the deployed `20260923140000` body rather than retyped, so the DNC write, the
-- inbound-return branch, the disclosure gate and the v_sched fix cannot drift.

create or replace function public.complete_existing_dial_disposition(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_disposition text,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns table(lead_state text, next_dial_after timestamptz, next_slot text, suppressed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_item public.lead_queue;
  v_lead public.agent_leads;
  v_phone text;
  v_slot text;
  v_now timestamptz := clock_timestamp();
  v_sched record;
  v_due_at timestamptz;
  v_due_slot text;
  v_stage_id uuid;
  v_stage_pipeline uuid;
  v_new_state text;
  v_suppressed boolean := false;
  v_reason text;
  v_existing_next_dial_after timestamptz;
  v_existing_next_slot text;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id
   for update;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;

  -- An inbound return call has no work item by design: it did not come from the queue, so nothing
  -- was ever claimed. Every other disposition still requires one, because every other disposition
  -- moves the queue row it belongs to.
  if v_attempt.work_item_id is null and p_disposition <> 'inbound_return_call' then
    raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING';
  end if;

  if v_attempt.disposition is not null then
    if v_attempt.disposition <> p_disposition then raise exception 'CALL_ATTEMPT_ALREADY_DISPOSITIONED'; end if;
    select l.lead_state, l.next_dial_after, l.next_preferred_slot
      into v_new_state, v_existing_next_dial_after, v_existing_next_slot
      from public.agent_leads l where l.id = v_attempt.lead_id and l.tenant_id = p_tenant_id;
    return query select v_new_state, v_existing_next_dial_after, v_existing_next_slot, false, 'Disposition was already recorded for this attempt.';
    return;
  end if;
  if v_attempt.disclosure_confirmed_at is null then raise exception 'DISCLOSURE_NOT_CONFIRMED'; end if;
  if coalesce(v_attempt.dial_clicked_at, p_dial_clicked_at) is null then raise exception 'DIAL_NOT_RECORDED'; end if;

  select * into v_lead from public.agent_leads
   where id = v_attempt.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  -- ── the inbound return call, handled before anything is mutated ──────────
  --
  -- Records the call and returns the lead's cadence EXACTLY as it already stood. No
  -- `attempts_made` increment, no `schedule_next_attempt`, no `lead_queue` write. The lead's place
  -- in the queue, its retry timer and its next slot are all left where the outbound cadence put
  -- them, which is decision 1's whole requirement.
  if p_disposition = 'inbound_return_call' then
    update public.tenant_call_attempts
       set disposition = p_disposition,
           dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at, v_now),
           provider_call_id = coalesce(provider_call_id, p_provider_call_id)
     where id = v_attempt.id;

    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
            jsonb_build_object('leadId', v_lead.id, 'disposition', p_disposition,
                               'leadState', v_lead.lead_state, 'countsTowardCadence', false));

    return query select v_lead.lead_state, v_lead.next_dial_after, v_lead.next_preferred_slot, false,
                        'Logged as an inbound return call. The outbound cadence is unchanged and no attempt was used.';
    return;
  end if;

  select * into v_item from public.lead_queue
   where id = v_attempt.work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'WORK_ITEM_NOT_FOUND'; end if;

  v_phone := v_lead.values->>'phone';
  v_slot := coalesce(v_attempt.slot, current_slot_for_state(v_lead.values->>'state', v_now), 'late_morning');
  update public.tenant_call_attempts
     set disposition = p_disposition,
         dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at),
         provider_call_id = coalesce(provider_call_id, p_provider_call_id)
   where id = v_attempt.id;
  update public.agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead.id;

  if p_disposition = 'do_not_call' then
    if v_phone is not null then
      perform suppress_phone(p_tenant_id, v_phone, 'internal', 'Agent recorded do not call on the dialer', 'disposition', p_agent_user_id);
      v_suppressed := true;
    end if;
    v_new_state := 'closed';
    v_reason := 'Added to the do-not-call list permanently. This lead will never be served again.';
  elsif p_disposition in ('wrong_number', 'disconnected') then
    v_new_state := 'closed';
    v_reason := 'Closed and flagged for a vendor credit claim.';
  elsif p_disposition in ('not_interested', 'did_not_qualify', 'application_submitted', 'sent_to_underwriting', 'no_payment_method') then
    v_new_state := 'closed';
    v_reason := 'Closed. No further attempts.';
  elsif p_disposition = 'callback_scheduled' then
    v_new_state := 'working';
    v_reason := 'A callback is scheduled; the cadence does not apply.';
  else
    select * into v_sched from schedule_next_attempt(p_tenant_id, v_lead.id, p_disposition, v_now);
    if v_sched.exhausted then
      v_new_state := 'exhausted';
      v_reason := format('Attempt %s reached the ceiling. Moved to nurture and no longer served.', coalesce(v_lead.attempts_made, 0) + 1);
      update public.agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
    else
      v_new_state := 'retry';
      v_reason := format('Attempt %s scheduled for %s in the %s slot.', v_sched.attempt_number, to_char(v_sched.due_at, 'Dy DD Mon HH24:MI'), replace(v_sched.slot, '_', ' '));
      v_due_at := v_sched.due_at;
      v_due_slot := v_sched.slot;
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot where id = v_lead.id;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update public.agent_leads set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
  end if;

  -- Route a TERMINAL outcome to the pipeline reserved for it.
  --
  -- 'closed' and 'exhausted' only: those are the states where the lead has finished with the
  -- dialer. A 'retry' is going back into the queue for the next attempt and a 'working' has a
  -- booked callback — both are still in flight, and moving them would take them off the board
  -- the dialer serves from, which is a worse failure than not routing at all.
  --
  -- The lookup is deliberately not confined to the lead's current pipeline: the destination is a
  -- DIFFERENT pipeline, reserved for that disposition. An unmapped disposition leaves both ids
  -- null and the lead where it is, so this is opt-in per disposition and a tenant that has
  -- configured nothing sees no change at all.
  if v_new_state in ('closed', 'exhausted') then
    select ps.id, ps.pipeline_id into v_stage_id, v_stage_pipeline
      from public.stage_dispositions sd
      join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
     where sd.tenant_id = p_tenant_id
       and sd.disposition_key = p_disposition
       and not ps.is_archived
     limit 1;
    if v_stage_id is not null then
      update public.agent_leads
         set stage_id = v_stage_id, pipeline_id = v_stage_pipeline
       where id = v_lead.id and tenant_id = p_tenant_id;
    end if;
  end if;
  update public.lead_queue
     set status = case when v_new_state = 'retry' then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         -- coalesce so an unmapped disposition leaves the work item alone. The lead and its
         -- queue row move together or not at all: a board renders from both, and a lead in
         -- pipeline A displaying a stage from pipeline B appears in no column.
         stage_id = coalesce(v_stage_id, stage_id),
         pipeline_id = coalesce(v_stage_pipeline, pipeline_id),
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
          jsonb_build_object('workItemId', v_item.id, 'leadId', v_lead.id, 'disposition', p_disposition, 'leadState', v_new_state));
  -- Say where it went. The agent is told the lead closed; without this they are not told it
  -- also left their board.
  if v_stage_id is not null then
    v_reason := v_reason || format(' Moved to %s.',
      (select ps.name from public.tenant_pipeline_stages ps where ps.id = v_stage_id));
  end if;

  return query select v_new_state,
                      v_due_at,
                      v_due_slot,
                      v_suppressed, v_reason;
end;
$function$;

revoke all on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;

-- ── asserted ───────────────────────────────────────────────────────────────
--
-- Plain substring search, not regex.
--
-- The first version of this block used `v_src !~ 'closed.., ..exhausted'`, where the two dots were
-- meant to stand in for the single quotes so the pattern would not need doubling inside a SQL
-- string literal. There is one character between `closed` and the comma, not two, so the pattern
-- never matched and the assertion raised on a function that was correct. The migration rolled back
-- twice on its own self-check.
--
-- `strpos` with a dollar-quoted needle has neither problem: the quotes are literal, there is no
-- pattern language to miscount in, and what is written is exactly what is searched for.
do $$
declare
  v_src text;
  v_count integer;
begin
  -- Overloads first. `select ... into` takes an arbitrary row when several match, so a leftover
  -- signature from an earlier migration could have this block inspecting a function that is not
  -- the one just created — passing or failing for reasons that have nothing to do with this change.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_existing_dial_disposition, found %. An overload means the dialer may call a different body than the one this migration wrote.', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';

  if strpos(v_src, 'stage_dispositions') = 0 then
    raise exception 'the dialer still does not consult the disposition-to-stage map';
  end if;

  -- Terminal only. If this ever admits 'retry', a lead going back into the queue would be moved off
  -- the dialer's own board between attempts.
  if strpos(v_src, $q$v_new_state in ('closed', 'exhausted')$q$) = 0 then
    raise exception 'the routing is no longer restricted to terminal dispositions';
  end if;

  -- Both rows move, or neither does.
  if strpos(v_src, 'coalesce(v_stage_id') = 0 or strpos(v_src, 'coalesce(v_stage_pipeline') = 0 then
    raise exception 'the work item no longer follows the lead into its pipeline';
  end if;

  -- And everything earlier migrations paid for.
  if strpos(v_src, 'inbound_return_call') = 0 then raise exception 'the inbound return branch was lost'; end if;
  if strpos(v_src, 'suppress_phone') = 0 then raise exception 'the do-not-call write was lost'; end if;
  if strpos(v_src, 'v_sched.due_at else null') > 0 then raise exception 'the v_sched fix was lost'; end if;

  raise notice 'LA-2: terminal dialer dispositions now route to their dedicated pipeline';
end $$;
