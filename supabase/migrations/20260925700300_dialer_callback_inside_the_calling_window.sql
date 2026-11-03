-- ---------------------------------------------------------------------------
-- Dialer · a callback booked from the dialer is inside the customer's calling window
--
-- Appointments audit (2026-09-25). complete_dial_disposition_with_callback (20260923170000, its only
-- definition) applied the wizard's future-time, timezone and assignee rules but not the calling
-- window. The route checked the window first in TypeScript (checkCallbackInCallingWindow), so the
-- screen was right — but the function is the one place every caller passes through, and the
-- wizard's own booking paths already refuse an out-of-window time in SQL
-- (assert_callback_in_window, 20260913360000). A caller that skipped the route could book 3am.
--
-- Restated in full from 20260923170000 with ONE line added, after the past-time check and before
-- anything is written:
--
--     perform public.assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at);
--
-- which raises CALLBACK_NO_STATE or CALLBACK_OUTSIDE_WINDOW. Both roll the whole call back, so a
-- refused time costs no attempt. The route words both codes. Same signature, same grants
-- (service_role only).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.assert_callback_in_window(uuid, uuid, timestamp with time zone)') is null then
    raise exception 'assert_callback_in_window does not exist; apply 20260913360000 before this file';
  end if;
end $$;

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
  -- 20260925700300: the customer's calling window at the booked instant, as the wizard's paths
  -- check it. Raises CALLBACK_NO_STATE / CALLBACK_OUTSIDE_WINDOW before anything is written.
  perform public.assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at);
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

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_dial_disposition_with_callback, found %', v_count;
  end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition_with_callback';

  if strpos(v_src, 'assert_callback_in_window(p_tenant_id, v_attempt.lead_id, v_scheduled_at)') = 0 then
    raise exception 'the dialer callback path does not check the calling window';
  end if;
  -- The window is checked before the call is recorded, so a refusal costs no attempt.
  if strpos(v_src, 'assert_callback_in_window') > strpos(v_src, 'complete_existing_dial_disposition') then
    raise exception 'the window is checked after the call was recorded';
  end if;
  -- Everything 20260923170000 asserted still holds.
  if strpos(v_src, 'insert into public.tenant_callbacks') = 0 or strpos(v_src, 'complete_existing_dial_disposition') = 0 then
    raise exception 'the dialer callback path lost its callback write or its call record';
  end if;
  if strpos(v_src, 'CALLBACK_DATE_PAST') = 0 or strpos(v_src, 'CALLBACK_TIMEZONE_INVALID') = 0 or strpos(v_src, 'CALLBACK_ASSIGNEE_INVALID') = 0 then
    raise exception 'the dialer callback path validates less than the wizard does';
  end if;
  if has_function_privilege('tenant_app', 'public.complete_dial_disposition_with_callback(uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text, timestamp with time zone, text)', 'execute') then
    raise exception 'complete_dial_disposition_with_callback is executable by tenant_app again';
  end if;
  raise notice '20260925700300: a dialer callback must fall inside the customer''s calling window';
end $$;
