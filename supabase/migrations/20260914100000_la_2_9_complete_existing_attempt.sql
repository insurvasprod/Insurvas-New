-- LA-2.9 corrective: complete the attempt already created by the disclosure workflow.
--
-- The original complete_dial_disposition function is intentionally append-only: it creates the
-- attempt and advances the queue in one transaction. The browser disclosure flow needs an attempt
-- id before the call, however, so it creates a pending attempt first. This companion function
-- completes that exact row and performs the same queue/lead transition atomically. It is additive,
-- service-role-only, and keeps the original function available for non-browser callers.

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
  if v_attempt.work_item_id is null then raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING'; end if;

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

  select * into v_item from public.lead_queue
   where id = v_attempt.work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'WORK_ITEM_NOT_FOUND'; end if;
  select * into v_lead from public.agent_leads
   where id = v_attempt.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

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
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot where id = v_lead.id;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update public.agent_leads set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
  end if;
  update public.lead_queue
     set status = case when v_new_state = 'retry' then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
          jsonb_build_object('workItemId', v_item.id, 'leadId', v_lead.id, 'disposition', p_disposition, 'leadState', v_new_state));
  return query select v_new_state,
                      case when v_new_state = 'retry' then v_sched.due_at else null end,
                      case when v_new_state = 'retry' then v_sched.slot else null end,
                      v_suppressed, v_reason;
end;
$function$;

revoke all on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;
