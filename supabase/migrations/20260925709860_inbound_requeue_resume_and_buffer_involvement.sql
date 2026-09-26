-- Inbound transfers, part 2 of 4: who may take a call, giving a transfer back, and resuming it.
-- Needs 20260925709850 (its columns and helpers).
--
--   LA-1.10-8   A dropped call goes back in the queue (return_transfer_to_queue, reason 'requeue').
--               It waits again from now, with the SLA ladder reset, exactly as a reopened expired
--               lead does. Any call record still open on an unclaimed transfer is stale by
--               definition, so a claim now closes every one of them, not only those past two hours.
--   LA-1.11-6   The re-claim resumes the SAME verification session: its confirmed and corrected
--               fields, and the corrected values already on the lead, are all still there. The
--               disposition walk that recorded the drop starts again from the stage's flow, so the
--               call gets a fresh outcome.
--   LA-1.14-9   Two different acts. Unassign (reason 'unassign') gives a transfer being worked back
--               to the queue: nobody owns it any more. End buffer involvement (end_buffer_involvement)
--               is the buffer assistant leaving a call the licensed agent now owns: ownership, the
--               call and the verification stay exactly where they are.
--   LA-1.14-10  A caller who asked for another language is claimed only by somebody who speaks it.
--               A licensed agent who does not may still take the call from a buffer who does,
--               because that buffer stays on the call (accept_buffer_handoff keeps buffer_user_id).
--               Claim next skips transfers the claimer cannot take.
--   LA-1.13-2   The buffer who claims a transfer is written to its deal row (deal_flow.buffer_agent).
--
-- claim_transfer_lead, claim_next_transfer, offer_buffer_handoff and accept_buffer_handoff are
-- restated from their live definitions (20260912400000, 20260924335100), changed only as above.

-- ── claim ───────────────────────────────────────────────────────────────────
create or replace function public.claim_transfer_lead(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_owner_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  item public.lead_queue%rowtype;
  session_id uuid;
  call_id uuid;
  resolved_submission_id uuid;
  resolved_role text;
  claim_status text;
  violation_constraint text;
  v_language text;
  v_resumed boolean := false;
begin
  select tu.role::text into resolved_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and u.status = 'active';
  if resolved_role is null or resolved_role <> p_owner_role or resolved_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select q.* into item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if item.status <> 'unclaimed' then raise exception using errcode = 'P0001', message = 'ALREADY_CLAIMED', detail = coalesce(item.owner_user_id::text, item.claimed_by::text, 'unknown'); end if;
  select l.submission_id, public.lead_language_key(l.values) into resolved_submission_id, v_language from public.agent_leads l where l.id = item.lead_id and l.tenant_id = p_tenant_id;
  -- LA-1.14-10: the caller asked for a language this member does not list.
  if not public.agent_speaks_language(p_tenant_id, p_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  claim_status := case when resolved_role = 'assistant' then 'buffer_active' else 'claimed' end;
  update public.lead_queue
     set status = claim_status, owner_user_id = p_user_id, claimed_by = p_user_id, owner_role = resolved_role,
         buffer_user_id = case when resolved_role = 'assistant' then p_user_id else null end,
         buffer_ended_at = null, claimed_at = now()
   where id = item.id and tenant_id = p_tenant_id and status = 'unclaimed';
  -- Nobody is on an unclaimed transfer, so every call record still open on it is stale.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = item.id and tenant_id = p_tenant_id and ended_at is null;
  -- LA-1.11-6: a transfer that was given back resumes its last verification session.
  if item.requeued_at is not null then
    update public.tenant_verification_sessions s
       set status = 'open', ended_at = null, completed_at = null, user_id = p_user_id, agent_role = resolved_role,
           last_actor_id = p_user_id, updated_at = now()
     where s.id = (
             select s2.id from public.tenant_verification_sessions s2
              where s2.tenant_id = p_tenant_id and s2.work_item_id = item.id and s2.ended_at is not null
              order by s2.started_at desc, s2.created_at desc
              limit 1)
       and not exists (select 1 from public.tenant_verification_sessions s3 where s3.work_item_id = item.id and s3.ended_at is null)
    returning s.id into session_id;
    v_resumed := session_id is not null;
  end if;
  if session_id is null then
    insert into public.tenant_verification_sessions(tenant_id, work_item_id, lead_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, p_user_id, resolved_role)
      on conflict (work_item_id) where ended_at is null do update set user_id = excluded.user_id, agent_role = excluded.agent_role, status = 'open', ended_at = null, updated_at = now() returning id into session_id;
  end if;
  begin
    insert into public.active_calls(tenant_id, work_item_id, lead_id, submission_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, resolved_submission_id, p_user_id, resolved_role) returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint = constraint_name;
    if violation_constraint <> 'active_calls_open_item_user_idx' then raise; end if;
    select id into call_id from public.active_calls where work_item_id = item.id and user_id = p_user_id and ended_at is null;
    if call_id is null then raise; end if;
  end;
  -- LA-1.13-2: the deal row names the buffer who took the call.
  if resolved_role = 'assistant' then
    update public.deal_flow set buffer_agent = p_user_id, updated_at = now() where tenant_id = p_tenant_id and lead_id = item.lead_id;
  end if;
  return jsonb_build_object('work_item_id', item.id, 'lead_id', item.lead_id, 'submission_id', resolved_submission_id, 'verification_session_id', session_id, 'active_call_id', call_id,
    'owner_user_id', p_user_id, 'owner_role', resolved_role, 'status', claim_status, 'claimed_at', (select claimed_at from public.lead_queue where id = item.id),
    'resumed_verification', v_resumed, 'language', v_language);
end;
$function$;

revoke all on function public.claim_transfer_lead(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_transfer_lead(uuid, uuid, uuid, text) to service_role;

-- ── claim next ──────────────────────────────────────────────────────────────
create or replace function public.claim_next_transfer(p_tenant_id uuid, p_user_id uuid, p_owner_role text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_work_item_id uuid;
begin
  select q.id into v_work_item_id
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id
     and q.partner_id is not null
     and q.status = 'unclaimed'
     and (p_partner_id is null or q.partner_id = p_partner_id)
     and (p_product_line is null or q.product_line = p_product_line)
     and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
     and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
     -- LA-1.14-10: never hand this agent a caller they cannot talk to.
     and public.agent_speaks_language(p_tenant_id, p_user_id, public.lead_language_key(l.values))
   order by q.queued_at asc, q.id asc
   limit 1
   for update of q skip locked;

  if v_work_item_id is null then
    raise exception using errcode = 'P0002', message = 'NO_TRANSFER_WAITING';
  end if;

  -- The row is locked by this transaction, so claim_transfer_lead's own FOR UPDATE re-reads it
  -- without waiting, and its status check still refuses anything that is no longer unclaimed.
  return public.claim_transfer_lead(p_tenant_id, v_work_item_id, p_user_id, p_owner_role);
end;
$function$;

revoke all on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) to service_role;

-- ── offer a handoff ─────────────────────────────────────────────────────────
create or replace function public.offer_buffer_handoff(p_tenant_id uuid, p_work_item_id uuid, p_buffer_user_id uuid, p_target_user_id uuid, p_timeout_seconds integer default 30, p_ip text default null::text, p_user_agent text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare queue_row public.lead_queue%rowtype; existing_handoff public.buffer_handoffs%rowtype; new_handoff public.buffer_handoffs%rowtype; buffer_role text; target_role text; session_exists boolean; call_exists boolean; v_language text;
begin
  if p_timeout_seconds < 5 or p_timeout_seconds > 300 then raise exception using errcode = '22023', message = 'INVALID_HANDOFF_TIMEOUT'; end if;
  select tu.role::text into buffer_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_buffer_user_id and u.status = 'active';
  if buffer_role <> 'assistant' then raise exception using errcode = '42501', message = 'BUFFER_ROLE_REQUIRED'; end if;
  select tu.role::text into target_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id and u.status = 'active';
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into queue_row from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if queue_row.status not in ('buffer_active', 'handed_pending') or queue_row.owner_user_id <> p_buffer_user_id then raise exception using errcode = '42501', message = 'BUFFER_OWNER_REQUIRED'; end if;
  select * into existing_handoff from public.buffer_handoffs where work_item_id = p_work_item_id and status = 'pending' for update;
  if found then
    if existing_handoff.licensed_agent_id <> p_target_user_id then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    return jsonb_build_object('handoff_id', existing_handoff.id, 'status', existing_handoff.status, 'expires_at', existing_handoff.expires_at, 'idempotent', true);
  end if;
  if queue_row.status <> 'buffer_active' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
  -- LA-1.14-10: the licensed agent speaks the caller's language, or the buffer on the call does.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_target_user_id, v_language) and not public.agent_speaks_language(p_tenant_id, p_buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select exists(select 1 from public.tenant_verification_sessions where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into session_exists;
  if not session_exists then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  select exists(select 1 from public.active_calls where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into call_exists;
  if not call_exists then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  insert into public.buffer_handoffs(tenant_id, work_item_id, buffer_user_id, licensed_agent_id, expires_at) values (p_tenant_id, p_work_item_id, p_buffer_user_id, p_target_user_id, now() + make_interval(secs => p_timeout_seconds)) returning * into new_handoff;
  update public.lead_queue set status = 'handed_pending', updated_at = now() where id = p_work_item_id;
  insert into public.audit_log(actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata) values ('tenant', p_buffer_user_id, 'tenant.buffer_handoff_offered', 'buffer_handoff', new_handoff.id::text, p_ip, p_user_agent, jsonb_build_object('workItemId', p_work_item_id, 'licensedAgentId', p_target_user_id, 'expiresAt', new_handoff.expires_at, 'language', v_language));
  return jsonb_build_object('handoff_id', new_handoff.id, 'status', new_handoff.status, 'expires_at', new_handoff.expires_at, 'idempotent', false);
end;
$function$;

revoke all on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) to service_role;

-- ── accept a handoff ────────────────────────────────────────────────────────
create or replace function public.accept_buffer_handoff(p_tenant_id uuid, p_handoff_id uuid, p_licensed_agent_id uuid, p_ip text default null::text, p_user_agent text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  handoff_row public.buffer_handoffs%rowtype;
  queue_row public.lead_queue%rowtype;
  session_row public.tenant_verification_sessions%rowtype;
  target_role text;
  call_count integer;
  v_language text;
begin
  perform public.expire_buffer_handoffs(p_tenant_id);
  select tu.role::text into target_role from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_licensed_agent_id
    and u.status = 'active';
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into handoff_row from public.buffer_handoffs where id = p_handoff_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'HANDOFF_NOT_FOUND'; end if;
  if handoff_row.status <> 'pending' or handoff_row.licensed_agent_id <> p_licensed_agent_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  if handoff_row.expires_at <= now() then raise exception using errcode = 'P0001', message = 'HANDOFF_EXPIRED'; end if;
  select * into queue_row from public.lead_queue where id = handoff_row.work_item_id and tenant_id = p_tenant_id for update;
  if queue_row.status <> 'handed_pending' or queue_row.owner_user_id <> handoff_row.buffer_user_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  -- LA-1.14-10: as on the offer, the buffer who stays on the call covers the caller's language.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_licensed_agent_id, v_language) and not public.agent_speaks_language(p_tenant_id, handoff_row.buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select * into session_row from public.tenant_verification_sessions where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  update public.active_calls set user_id = p_licensed_agent_id, agent_role = target_role, updated_at = now()
  where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null;
  get diagnostics call_count = row_count;
  if call_count <> 1 then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  update public.tenant_verification_sessions set user_id = p_licensed_agent_id, agent_role = target_role, last_actor_id = p_licensed_agent_id, updated_at = now() where id = session_row.id;
  -- The buffer stays involved (buffer_user_id kept, buffer_ended_at clear) until they end it.
  update public.lead_queue set status = 'la_active', owner_user_id = p_licensed_agent_id, claimed_by = p_licensed_agent_id, owner_role = target_role, buffer_ended_at = null, updated_at = now() where id = queue_row.id;
  update public.buffer_handoffs set status = 'accepted', accepted_at = now(), updated_at = now() where id = handoff_row.id;
  update public.deal_flow set buffer_agent = coalesce(buffer_agent, handoff_row.buffer_user_id), updated_at = now() where tenant_id = p_tenant_id and lead_id = queue_row.lead_id and buffer_agent is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_licensed_agent_id, 'tenant.buffer_handoff_accepted', 'buffer_handoff', handoff_row.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', queue_row.id, 'bufferUserId', handoff_row.buffer_user_id, 'progressPercentage', session_row.progress_percentage, 'language', v_language));
  return jsonb_build_object('handoff_id', handoff_row.id, 'work_item_id', queue_row.id, 'status', 'accepted', 'verification_session_id', session_row.id, 'progress_percentage', session_row.progress_percentage);
end;
$function$;

revoke all on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) to service_role;

-- ── give a transfer back to the queue ───────────────────────────────────────
-- p_reason 'unassign': a transfer being worked (claimed, with a buffer, or with a licensed agent)
--   goes back to waiting. The person who has it, or the account owner, may do it. A handoff still
--   being offered must be accepted or time out first.
-- p_reason 'requeue': a transfer whose call dropped goes back to waiting. The agent who had it, the
--   agent who recorded the drop, or the account owner, may do it.
-- Either way the transfer waits again from now with the SLA ladder reset, its open call records and
-- verification session are closed (the session is kept, and the next claim reopens it), and nobody
-- owns it.
create or replace function public.return_transfer_to_queue(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_flow public.tenant_disposition_flows%rowtype;
  v_session uuid;
begin
  if p_reason is null or p_reason not in ('unassign', 'requeue') then raise exception using errcode = '22023', message = 'INVALID_RELEASE_REASON'; end if;
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.partner_id is null then raise exception using errcode = 'P0001', message = 'NOT_A_TRANSFER'; end if;
  if q.status = 'unclaimed' then
    return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', q.status, 'duplicate', true);
  end if;
  if p_reason = 'unassign' then
    if q.status = 'handed_pending' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    if q.status not in ('claimed', 'buffer_active', 'la_active') then raise exception using errcode = 'P0001', message = 'NOT_BEING_WORKED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor then raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED'; end if;
  else
    if q.status <> 'dropped' then raise exception using errcode = 'P0001', message = 'NOT_DROPPED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor and q.disposition_by is distinct from p_actor then
      raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
    end if;
  end if;

  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null;
  update public.tenant_verification_sessions
     set status = 'closed', ended_at = now(), updated_at = now(), last_actor_id = p_actor
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null
  returning id into v_session;

  if p_reason = 'requeue' then
    -- The drop was recorded. The next call gets its own outcome, walked from the stage it is in now.
    delete from public.disposition_walk_steps s using public.disposition_walks w
     where s.walk_id = w.id and w.tenant_id = p_tenant_id and w.work_item_id = q.id;
    select f.* into v_flow from public.tenant_disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = q.stage_id and f.is_active;
    if found then
      update public.disposition_walks
         set flow_id = v_flow.id, current_node_id = v_flow.root_node_id, status = 'open', completed_at = null,
             final_disposition_key = null, composed_note = null, updated_at = now()
       where tenant_id = p_tenant_id and work_item_id = q.id;
    else
      delete from public.disposition_walks where tenant_id = p_tenant_id and work_item_id = q.id;
    end if;
  end if;

  update public.lead_queue
     set status = 'unclaimed', owner_user_id = null, claimed_by = null, owner_role = null,
         buffer_user_id = null, buffer_ended_at = null, claimed_at = null, queued_at = now(),
         sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,
         requeued_at = now(), requeue_count = coalesce(requeue_count, 0) + 1, updated_at = now()
   where id = q.id and tenant_id = p_tenant_id;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, case when p_reason = 'requeue' then 'tenant.transfer_requeued' else 'tenant.transfer_unassigned' end, 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'previousStatus', q.status, 'previousOwnerId', q.owner_user_id, 'bufferUserId', q.buffer_user_id,
      'verificationSessionId', v_session, 'requeueCount', coalesce(q.requeue_count, 0) + 1));

  return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', 'unclaimed', 'previous_status', q.status,
    'verification_session_id', v_session, 'requeue_count', coalesce(q.requeue_count, 0) + 1, 'duplicate', false);
end;
$function$;

revoke all on function public.return_transfer_to_queue(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.return_transfer_to_queue(uuid, uuid, uuid, text) to service_role;

-- ── end buffer involvement ──────────────────────────────────────────────────
-- The buffer leaves a call the licensed agent already owns. Nothing about the transfer's owner,
-- call record or verification changes. The buffer themselves, the licensed agent who has the
-- transfer, or the account owner may do it. While the buffer still owns the call (before any
-- handoff) there is nothing to end: they hand off, or unassign. When the caller asked for a
-- language the licensed agent does not list, the buffer was the one covering it, so leaving needs
-- p_acknowledge_language.
create or replace function public.end_buffer_involvement(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_acknowledge_language boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_language text;
  v_cover_ends boolean := false;
begin
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.buffer_user_id is null then raise exception using errcode = 'P0001', message = 'NO_BUFFER_INVOLVED'; end if;
  if q.buffer_ended_at is not null then
    return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'buffer_ended_at', q.buffer_ended_at, 'duplicate', true);
  end if;
  if q.status in ('buffer_active', 'handed_pending') then raise exception using errcode = 'P0001', message = 'BUFFER_OWNS_CALL'; end if;
  if v_role <> 'owner' and p_actor is distinct from q.buffer_user_id and p_actor is distinct from q.owner_user_id then
    raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
  end if;
  if q.status in ('claimed', 'la_active') and q.owner_user_id is not null then
    select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = q.lead_id and l.tenant_id = p_tenant_id;
    v_cover_ends := not public.agent_speaks_language(p_tenant_id, q.owner_user_id, v_language);
    if v_cover_ends and not coalesce(p_acknowledge_language, false) then
      raise exception using errcode = 'P0001', message = 'LANGUAGE_COVER_REQUIRED', detail = v_language;
    end if;
  end if;
  update public.lead_queue set buffer_ended_at = now(), updated_at = now() where id = q.id and tenant_id = p_tenant_id;
  -- A call record the buffer still holds on this transfer ends with their involvement.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and user_id = q.buffer_user_id and ended_at is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.buffer_involvement_ended', 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'bufferUserId', q.buffer_user_id, 'licensedAgentId', q.owner_user_id, 'status', q.status,
      'language', v_language, 'languageCoverEnded', v_cover_ends));
  return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'owner_user_id', q.owner_user_id, 'status', q.status,
    'buffer_ended_at', now(), 'language_cover_ended', v_cover_ends, 'duplicate', false);
end;
$function$;

revoke all on function public.end_buffer_involvement(uuid, uuid, uuid, boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.end_buffer_involvement(uuid, uuid, uuid, boolean) to service_role;

-- ── assertions ──────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709860: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_transfer_lead'
                  and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0
                  and position('item.requeued_at is not null' in prosrc) > 0
                  and position('started_at<now()-interval' in replace(prosrc, ' ', '')) = 0) then
    raise exception '20260925709860: claim_transfer_lead does not gate language, resume a returned session, or still closes only old calls';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_next_transfer'
                  and position('agent_speaks_language' in prosrc) > 0 and position('skip locked' in prosrc) > 0) then
    raise exception '20260925709860: claim_next_transfer does not skip callers the agent cannot talk to';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'accept_buffer_handoff'
                  and position('buffer_ended_at = null' in prosrc) > 0 and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0) then
    raise exception '20260925709860: accept_buffer_handoff does not keep the buffer on the call';
  end if;
  if to_regprocedure('public.return_transfer_to_queue(uuid, uuid, uuid, text)') is null
     or to_regprocedure('public.end_buffer_involvement(uuid, uuid, uuid, boolean)') is null then
    raise exception '20260925709860: the release functions are missing';
  end if;
  if has_function_privilege('anon', 'public.return_transfer_to_queue(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.end_buffer_involvement(uuid, uuid, uuid, boolean)', 'execute') then
    raise exception '20260925709860: a release function is callable from the browser';
  end if;
  -- Coverage: LA-1.10-8, LA-1.11-6, LA-1.13-2 (buffer on the deal), LA-1.14-9, LA-1.14-10.
end $$;
