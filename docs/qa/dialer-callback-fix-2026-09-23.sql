-- LA-2 · a callback scheduled from the dialer is never scheduled.
--
-- Measured live 2026-09-23. An agent presses "callback scheduled" on the dialer, the call history
-- then displays "Callback scheduled" under Next step, and:
--
--     tenant_callbacks on the tenant:  0
--     the lead:   lead_state=working, next_dial_after=null
--     work item:  status=completed, disposition=callback_scheduled
--
-- The lead now matches none of `serve_next_lead`'s six tiers — tier 2 wants a callback row AND an
-- unclaimed work item, tiers 4/5/6 want retry/fresh/nurture with a due timer — and the Callbacks
-- screen reads `tenant_callbacks`, which has no row for it. The lead is on no queue, no board and
-- no screen. Nothing errored; the screen said it worked.
--
-- ── Why this is not simply a call to complete_disposition_with_callback ────
--
-- That is the wizard's function and it is the right one for the wizard. It cannot be reused whole
-- from the dialer, for two reasons that only show up on reading it:
--
--   It calls `complete_disposition`, which requires a COMPLETED DISPOSITION WALK — `select ... from
--   disposition_walks where id = p_walk_id` then `raise DISPOSITION_WALK_NOT_FOUND`. The dialer has
--   no walk; its agent answered no wizard. Fabricating one to satisfy a foreign key would put a
--   flow in the audit trail that nobody saw.
--
--   `complete_disposition` never touches `tenant_call_attempts`. The dialer's function stamps the
--   attempt's disposition, its `dial_clicked_at` and `provider_call_id`, increments
--   `attempts_made`, and carries the inbound-return branch. Routing through the wizard would throw
--   all of that away — the call would be scheduled and the call itself would go unrecorded.
--
-- So this keeps the dialer's function for the call, and reuses the wizard's VALIDATION and its
-- callback write around it: same future-time rule, same real-timezone rule, same assignee check,
-- same idempotency key, same `callback_history` and audit rows. One function, so one transaction:
-- if the callback cannot be written the disposition rolls back with it, and the silent loss this
-- fixes cannot happen in the other direction.
--
-- Validation runs BEFORE the disposition. A bad timezone should cost nothing; discovering it after
-- the attempt is stamped would leave the agent with a recorded call and no callback, which is the
-- state this migration exists to remove.

create or replace function public.complete_dial_disposition_with_callback(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_callback_local timestamp without time zone,
  p_customer_timezone text,
  p_assigned_to uuid default null,
  p_callback_note text default null,
  p_idempotency_key text default null,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_existing public.tenant_callbacks;
  v_callback public.tenant_callbacks;
  v_assignee uuid;
  v_scheduled_at timestamptz;
  v_result record;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.work_item_id is null then raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING'; end if;

  -- Idempotency first, and it returns without dispositioning. A retried request must not spend a
  -- second attempt on the lead's cadence just because the first response was lost.
  if p_idempotency_key is not null then
    select c.* into v_existing
      from public.tenant_callbacks c
     where c.tenant_id = p_tenant_id and c.idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'callback_id', v_existing.id,
        'scheduled_at_utc', v_existing.scheduled_at_utc,
        'status', v_existing.status,
        'duplicate', true);
    end if;
  end if;

  -- The wizard's rules, applied identically. Cheap, and every one of them fails before a write.
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(p_customer_timezone)) then
    raise exception 'CALLBACK_TIMEZONE_INVALID';
  end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  if p_callback_note is not null
     and (char_length(btrim(p_callback_note)) < 1 or char_length(btrim(p_callback_note)) > 1000) then
    raise exception 'CALLBACK_NOTE_INVALID';
  end if;

  v_assignee := coalesce(p_assigned_to, p_agent_user_id);
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = v_assignee
       and tu.accepted_at is not null and u.status::text = 'active'
  ) then raise exception 'CALLBACK_ASSIGNEE_INVALID'; end if;

  -- The call itself: attempt row, attempts_made, lead state, work item, and the pipeline routing
  -- added in 20260923160000. Unchanged, and still the only thing that records the call.
  select * into v_result
    from public.complete_existing_dial_disposition(
      p_tenant_id, p_attempt_id, p_agent_user_id, 'callback_scheduled',
      p_dial_clicked_at, p_provider_call_id);

  insert into public.tenant_callbacks
    (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by, idempotency_key)
  values
    (p_tenant_id, v_attempt.lead_id, v_attempt.work_item_id, v_scheduled_at, btrim(p_customer_timezone),
     v_assignee, nullif(btrim(p_callback_note), ''), 'scheduled', p_agent_user_id, p_idempotency_key)
  returning * into v_callback;

  insert into public.callback_history
    (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values
    (p_tenant_id, v_callback.id, v_attempt.lead_id, p_agent_user_id, 'scheduled',
     v_callback.scheduled_at_utc, v_callback.status, v_callback.note);

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.callback_scheduled', 'callback', v_callback.id::text,
          jsonb_build_object('leadId', v_callback.lead_id, 'workItemId', v_callback.work_item_id,
                             'scheduledAtUtc', v_callback.scheduled_at_utc,
                             'customerTimezone', v_callback.customer_timezone,
                             'source', 'dialer', 'attemptId', p_attempt_id));

  return jsonb_build_object(
    'lead_state', v_result.lead_state,
    'reason', v_result.reason,
    'callback_id', v_callback.id,
    'scheduled_at_utc', v_callback.scheduled_at_utc,
    'customer_timezone', v_callback.customer_timezone,
    'assigned_to', v_callback.assigned_to,
    'duplicate', false);
end;
$function$;

revoke all on function public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamptz, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamptz, text)
  to service_role;

do $$
declare
  v_src text;
  v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_dial_disposition_with_callback, found %', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';

  -- It must actually write a callback; that is the entire point.
  if strpos(v_src, 'insert into public.tenant_callbacks') = 0 then
    raise exception 'the dialer callback path does not create a callback';
  end if;
  -- And it must still record the call, or a scheduled callback would cost no attempt.
  if strpos(v_src, 'complete_existing_dial_disposition') = 0 then
    raise exception 'the dialer callback path no longer records the call attempt';
  end if;
  -- The wizard's rules, not a looser set of our own.
  if strpos(v_src, 'CALLBACK_DATE_PAST') = 0
     or strpos(v_src, 'CALLBACK_TIMEZONE_INVALID') = 0
     or strpos(v_src, 'CALLBACK_ASSIGNEE_INVALID') = 0 then
    raise exception 'the dialer callback path validates less than the wizard does';
  end if;

  raise notice 'LA-2: a callback scheduled from the dialer now creates a real callback';
end $$;
