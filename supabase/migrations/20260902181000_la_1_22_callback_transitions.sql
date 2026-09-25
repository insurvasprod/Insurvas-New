-- LA-1.22: callback lifecycle transitions. All writes remain atomic and auditable.

create or replace function public.reschedule_callback(
  p_tenant_id uuid, p_callback_id uuid, p_actor uuid, p_callback_local timestamp without time zone
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.callbacks; v_old timestamptz; v_scheduled_at timestamptz;
begin
  select * into c from public.callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if c.status in ('completed', 'cancelled') then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  v_old := c.scheduled_at_utc;
  v_scheduled_at := p_callback_local at time zone c.customer_timezone;
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  update public.callbacks set scheduled_at_utc = v_scheduled_at, status = 'scheduled', reminder_sent_at = null, updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'rescheduled', v_old, c.scheduled_at_utc, 'scheduled', c.status, c.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_rescheduled', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id, 'scheduledAtUtc', c.scheduled_at_utc));
  return jsonb_build_object('id', c.id, 'scheduled_at_utc', c.scheduled_at_utc, 'status', c.status, 'customer_timezone', c.customer_timezone);
end;
$$;

create or replace function public.cancel_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.callbacks;
begin
  select * into c from public.callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then raise exception 'CALLBACK_ALREADY_COMPLETED'; end if;
  if c.status = 'cancelled' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  update public.callbacks set status = 'cancelled', updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'cancelled', c.scheduled_at_utc, 'scheduled', c.status, c.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_cancelled', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id));
  return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', false);
end;
$$;

create or replace function public.complete_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.callbacks; q public.lead_queue;
begin
  select * into c from public.callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  if c.status = 'cancelled' then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  update public.callbacks set status = 'completed', completed_at = now(), updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'completed', c.scheduled_at_utc, 'scheduled', c.status, c.note);
  update public.lead_queue set status = 'unclaimed', owner_user_id = null, owner_role = null, claimed_by = null, claimed_at = null, disposition = null, disposition_at = null, disposition_by = null, updated_at = now()
  where id = c.work_item_id and tenant_id = p_tenant_id and status in ('completed', 'dropped') returning * into q;
  update public.agent_leads set callback_subtype = null, updated_at = now() where id = c.lead_id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_completed', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id, 'workItemId', c.work_item_id, 'reopened', q.id is not null));
  return jsonb_build_object('id', c.id, 'status', c.status, 'work_item_id', c.work_item_id, 'reopened', q.id is not null, 'duplicate', false);
end;
$$;

revoke all on function public.reschedule_callback(uuid, uuid, uuid, timestamp without time zone), public.cancel_callback(uuid, uuid, uuid), public.complete_callback(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_callback(uuid, uuid, uuid, timestamp without time zone), public.cancel_callback(uuid, uuid, uuid), public.complete_callback(uuid, uuid, uuid) to service_role;

create or replace function public.claim_callback_reminders(p_now timestamptz, p_until timestamptz, p_limit integer default 100)
returns setof public.callbacks language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.callbacks;
begin
  for c in select * from public.callbacks where status = 'scheduled' and reminder_sent_at is null and scheduled_at_utc > p_now and scheduled_at_utc <= p_until order by scheduled_at_utc for update skip locked limit greatest(1, least(p_limit, 500)) loop
    update public.callbacks set reminder_sent_at = p_now, updated_at = p_now where id = c.id returning * into c;
    return next c;
  end loop;
end;
$$;
revoke all on function public.claim_callback_reminders(timestamptz, timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_callback_reminders(timestamptz, timestamptz, integer) to service_role;
