-- LA-1.11 forward fix: qualify the stored new_value column so the PL/pgSQL variable cannot
-- shadow it. The previous function was installed before this migration was applied.
create or replace function public.update_verification_field(
  p_tenant_id uuid, p_session_id uuid, p_work_item_id uuid, p_user_id uuid,
  p_field_key text, p_state text, p_new_value jsonb, p_required_keys text[], p_visible_keys text[],
  p_ip text default null, p_user_agent text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  session_row public.verification_sessions%rowtype;
  queue_row public.lead_queue%rowtype;
  lead_row public.agent_leads%rowtype;
  current_value jsonb;
  next_value jsonb;
  next_progress integer;
  field_exists boolean;
begin
  if p_state not in ('confirmed', 'corrected', 'outstanding') then raise exception using errcode = '22023', message = 'INVALID_VERIFICATION_STATE'; end if;
  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]*$' then raise exception using errcode = '22023', message = 'INVALID_FIELD_KEY'; end if;
  select * into session_row from public.verification_sessions where id = p_session_id and tenant_id = p_tenant_id and work_item_id = p_work_item_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  select * into queue_row from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id and status = 'claimed' and owner_user_id = p_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'VERIFICATION_OWNER_REQUIRED'; end if;
  select * into lead_row from public.agent_leads where id = queue_row.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'LEAD_NOT_FOUND'; end if;
  select exists (select 1 from public.verification_fields where session_id = p_session_id and field_key = p_field_key) into field_exists;
  if not field_exists then raise exception using errcode = 'P0002', message = 'VERIFICATION_FIELD_NOT_FOUND'; end if;
  current_value := coalesce(lead_row.values -> p_field_key, 'null'::jsonb);
  if p_state = 'corrected' then
    next_value := p_new_value;
    update public.agent_leads set values = jsonb_set(lead_row.values, array[p_field_key], p_new_value, true), updated_at = now() where id = lead_row.id and tenant_id = p_tenant_id;
    insert into public.verification_field_changes (tenant_id, session_id, lead_id, field_key, old_value, new_value, actor_id) values (p_tenant_id, p_session_id, lead_row.id, p_field_key, current_value, next_value, p_user_id);
  elsif p_state = 'confirmed' then next_value := current_value;
  else next_value := null;
  end if;
  update public.verification_fields set is_required = field_key = any(coalesce(p_required_keys, array[]::text[])), is_visible = field_key = any(coalesce(p_visible_keys, array[]::text[])) where session_id = p_session_id;
  update public.verification_fields set state = p_state, old_value = case when p_state = 'outstanding' then old_value else current_value end, new_value = case when p_state = 'outstanding' then public.verification_fields.new_value else next_value end, confirmed_at = case when p_state = 'outstanding' then null else now() end, actor_id = p_user_id where session_id = p_session_id and field_key = p_field_key;
  select case when count(*) filter (where is_required and is_visible) = 0 then 100 else round(100.0 * count(*) filter (where is_required and is_visible and state in ('confirmed', 'corrected')) / count(*) filter (where is_required and is_visible))::integer end into next_progress from public.verification_fields where session_id = p_session_id;
  update public.verification_sessions set progress_percentage = next_progress, completed_at = case when next_progress = 100 then coalesce(completed_at, now()) else null end, last_actor_id = p_user_id, updated_at = now() where id = p_session_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata) values ('tenant', p_user_id, 'tenant.verification_field_updated', 'agent_lead', lead_row.id::text, p_ip, p_user_agent, jsonb_build_object('sessionId', p_session_id, 'workItemId', p_work_item_id, 'fieldKey', p_field_key, 'state', p_state));
  return jsonb_build_object('session_id', p_session_id, 'field_key', p_field_key, 'state', p_state, 'progress_percentage', next_progress, 'completed_at', (select completed_at from public.verification_sessions where id = p_session_id));
end;
$$;
revoke all on function public.update_verification_field(uuid, uuid, uuid, uuid, text, text, jsonb, text[], text[], text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.update_verification_field(uuid, uuid, uuid, uuid, text, text, jsonb, text[], text[], text, text) to service_role;
