-- Book a callback from the Callbacks page (owner, 2026-10-28: "add a callback").
--
-- Until now a callback was only ever created by a call outcome: complete_disposition_with_callback
-- (transfer wizard) and complete_dial_disposition_with_callback (dialer). Both record a disposition
-- first. This books one on its own, for a lead the agent can already see, with the same rules:
--   - the same tenant_callbacks row, history row and audit row those functions write;
--   - in the customer's own time, never in the past, inside the calling window
--     (assert_callback_in_window, as the dialer's function does);
--   - assigned to the person booking it (enforce_callback_assignee_role still runs);
--   - one open callback per lead: tenant_callbacks_replace_open_one cancels the old one on insert
--     and records it as 'replaced'.
-- tenant_callbacks.work_item_id is not null, so the lead's latest work item carries it; a lead that
-- has never been in the queue is refused with CALLBACK_NO_WORK_ITEM.
-- No table changes. Service role only, like the other booking functions.

create or replace function public.book_callback(
  p_tenant_id uuid, p_lead_id uuid, p_actor uuid,
  p_callback_local timestamp without time zone, p_customer_timezone text,
  p_note text default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_existing public.tenant_callbacks;
  v_callback public.tenant_callbacks;
  v_work_item uuid;
  v_scheduled_at timestamptz;
begin
  if p_idempotency_key is not null then
    select c.* into v_existing from public.tenant_callbacks c where c.tenant_id = p_tenant_id and c.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('callback_id', v_existing.id, 'scheduled_at_utc', v_existing.scheduled_at_utc, 'status', v_existing.status, 'duplicate', true); end if;
  end if;
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if not exists (select 1 from public.agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id) then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(p_customer_timezone)) then raise exception 'CALLBACK_TIMEZONE_INVALID'; end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  perform public.assert_callback_in_window(p_tenant_id, p_lead_id, v_scheduled_at);
  if p_note is not null and char_length(btrim(p_note)) > 1000 then raise exception 'CALLBACK_NOTE_INVALID'; end if;

  select q.id into v_work_item from public.lead_queue q
  where q.tenant_id = p_tenant_id and q.lead_id = p_lead_id
  order by q.created_at desc limit 1;
  if v_work_item is null then raise exception 'CALLBACK_NO_WORK_ITEM'; end if;

  insert into public.tenant_callbacks (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by, idempotency_key)
  values (p_tenant_id, p_lead_id, v_work_item, v_scheduled_at, btrim(p_customer_timezone), p_actor, nullif(btrim(p_note), ''), 'scheduled', p_actor, p_idempotency_key)
  returning * into v_callback;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note, via)
  values (p_tenant_id, v_callback.id, p_lead_id, p_actor, 'scheduled', v_callback.scheduled_at_utc, v_callback.status, v_callback.note, 'manual');
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_scheduled', 'callback', v_callback.id::text, jsonb_build_object('leadId', p_lead_id, 'workItemId', v_work_item, 'scheduledAtUtc', v_callback.scheduled_at_utc, 'customerTimezone', v_callback.customer_timezone, 'source', 'callbacks_page'));
  return jsonb_build_object('callback_id', v_callback.id, 'scheduled_at_utc', v_callback.scheduled_at_utc, 'customer_timezone', v_callback.customer_timezone, 'assigned_to', v_callback.assigned_to, 'duplicate', false);
end;
$$;

revoke all on function public.book_callback(uuid, uuid, uuid, timestamp without time zone, text, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.book_callback(uuid, uuid, uuid, timestamp without time zone, text, text, text) to service_role;
