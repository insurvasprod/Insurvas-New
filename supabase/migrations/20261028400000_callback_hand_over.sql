-- Hand a callback over (Callbacks A, owner 2026-10-28: "Give to…" and "Put in shared queue").
--
-- Until now only the due job moved a callback's lead to the shared queue (run_callback_due, thirty
-- minutes overdue) and nothing could change who holds a callback. Two functions, with the same rules
-- as reschedule / cancel / complete (20260925711600):
--   - the actor is an active member who may manage the callback (callback_actor_may_manage: the
--     assignee, whoever booked it, an owner or an assistant), else CALLBACK_NOT_YOURS;
--   - only an open callback (scheduled, due, missed), else CALLBACK_NOT_ACTIVE;
--   - a callback_history row and an audit_log row each time.
--
-- reassign_callback: the callback goes to another agent. enforce_callback_assignee_role (the
-- callbacks_assignee_role trigger) still decides who may hold one (owner, producer, assistant; active).
-- A work item the old holder had claimed and not yet dispositioned moves with it; a callback that had
-- been put in the shared queue is taken back out for the new holder.
--
-- release_callback_to_queue: the lead goes to the shared queue now, as the due job does after thirty
-- minutes: its work item unclaimed and undispositioned, an outbound lead back on its cadence, the
-- callback marked released (the app shows "Shared queue"). An inbound partner transfer never goes to
-- the pool (CALLBACK_RELEASE_INBOUND), as in callback_reopen_lead.
--
-- One table change: callback_history.action gains 'reassigned'. Service role only, like the others.

set local lock_timeout = '5s';

alter table public.callback_history drop constraint if exists callback_history_action_check;
alter table public.callback_history add constraint callback_history_action_check
  check (action in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'missed', 'reopened', 'released', 'replaced', 'reassigned'));

create or replace function public.reassign_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid, p_assignee uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  v_old uuid;
  v_was_released boolean;
  v_moved text := 'none';
  v_name text;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if not public.callback_actor_may_manage(p_tenant_id, c.id, p_actor) then raise exception 'CALLBACK_NOT_YOURS'; end if;
  if c.status not in ('scheduled', 'due', 'missed') then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  if p_assignee is null then raise exception 'CALLBACK_ASSIGNEE_ROLE_INVALID'; end if;
  if c.assigned_to = p_assignee and c.released_at is null then
    return jsonb_build_object('id', c.id, 'assigned_to', c.assigned_to, 'duplicate', true);
  end if;

  v_old := c.assigned_to;
  v_was_released := c.released_at is not null;
  -- The assignee check runs in the callbacks_assignee_role trigger.
  update public.tenant_callbacks set assigned_to = p_assignee, released_at = null, updated_at = now() where id = c.id returning * into c;

  -- The work item follows: claimed by the old holder and not yet worked, or waiting in the pool
  -- because the callback had been released.
  update public.lead_queue q
     set owner_user_id = p_assignee, claimed_by = p_assignee, claimed_at = now(), locked_until = null, updated_at = now()
   where q.id = c.work_item_id and q.tenant_id = p_tenant_id
     and q.status = 'claimed' and q.disposition is null and q.owner_user_id is not distinct from v_old;
  if found then v_moved := 'claimed'; end if;
  if v_moved = 'none' and v_was_released then
    update public.lead_queue q
       set status = 'claimed', owner_user_id = p_assignee, claimed_by = p_assignee, claimed_at = now(), locked_until = null, updated_at = now()
     where q.id = c.work_item_id and q.tenant_id = p_tenant_id and q.status = 'unclaimed' and q.disposition is null;
    if found then v_moved := 'from_pool'; end if;
  end if;
  if to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
    if v_old is not null then perform public.refresh_agent_capacity_for_user(p_tenant_id, v_old); end if;
    perform public.refresh_agent_capacity_for_user(p_tenant_id, p_assignee);
  end if;

  select u.name into v_name from public.users u where u.id = p_assignee;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note, via)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'reassigned', c.scheduled_at_utc, c.scheduled_at_utc, c.status, c.status,
          'Given to ' || coalesce(v_name, 'another agent') || case when v_was_released then ', out of the shared queue' else '' end || '.', 'manual');
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_reassigned', 'callback', c.id::text,
          jsonb_build_object('leadId', c.lead_id, 'workItemId', c.work_item_id, 'from', v_old, 'to', p_assignee, 'workItem', v_moved, 'wasReleased', v_was_released));
  return jsonb_build_object('id', c.id, 'assigned_to', c.assigned_to, 'work_item', v_moved, 'duplicate', false);
end;
$function$;
revoke all on function public.reassign_callback(uuid, uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reassign_callback(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.release_callback_to_queue(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  q public.lead_queue;
  v_lead public.agent_leads;
  v_pooled boolean := false;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if not public.callback_actor_may_manage(p_tenant_id, c.id, p_actor) then raise exception 'CALLBACK_NOT_YOURS'; end if;
  if c.status not in ('scheduled', 'due', 'missed') then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  if c.released_at is not null then return jsonb_build_object('id', c.id, 'released_at', c.released_at, 'duplicate', true); end if;

  select * into v_lead from public.agent_leads where id = c.lead_id and tenant_id = p_tenant_id for update;
  select * into q from public.lead_queue where id = c.work_item_id and tenant_id = p_tenant_id for update;
  if v_lead.id is null or q.id is null then raise exception 'CALLBACK_NOT_FOUND'; end if;
  -- An inbound partner transfer is the agency's promise to that partner: it never goes to the pool.
  if v_lead.partner_id is not null or q.partner_id is not null then raise exception 'CALLBACK_RELEASE_INBOUND'; end if;

  -- Into the pool, unless the lead is already being worked through another work item.
  if not exists (select 1 from public.lead_queue o
                  where o.tenant_id = p_tenant_id and o.lead_id = c.lead_id and o.id <> q.id
                    and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active')) then
    update public.lead_queue
       set status = 'unclaimed', owner_user_id = null, claimed_by = null, claimed_at = null,
           locked_until = null, disposition = null, disposition_at = null, disposition_by = null, updated_at = now()
     where id = q.id and status in ('claimed', 'unclaimed', 'completed', 'dropped');
    v_pooled := found;
    if v_pooled and v_lead.lead_state = 'working' then
      update public.agent_leads
         set lead_state = case when coalesce(attempts_made, 0) = 0 then 'fresh' else 'retry' end,
             next_dial_after = case when coalesce(attempts_made, 0) = 0 then null else now() end,
             updated_at = now()
       where id = v_lead.id and tenant_id = p_tenant_id;
    end if;
  end if;

  update public.tenant_callbacks set released_at = now(), updated_at = now() where id = c.id returning * into c;
  if c.assigned_to is not null and to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
    perform public.refresh_agent_capacity_for_user(p_tenant_id, c.assigned_to);
  end if;

  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'released', c.scheduled_at_utc, c.status, c.status,
          case when v_pooled then 'Put in the shared queue: anyone on the team can call it.' else 'Put in the shared queue; the lead is already being worked.' end, 'manual');
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_released', 'callback', c.id::text,
          jsonb_build_object('leadId', c.lead_id, 'workItemId', c.work_item_id, 'pooled', v_pooled, 'heldBy', c.assigned_to));
  return jsonb_build_object('id', c.id, 'released_at', c.released_at, 'pooled', v_pooled, 'duplicate', false);
end;
$function$;
revoke all on function public.release_callback_to_queue(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.release_callback_to_queue(uuid, uuid, uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.reassign_callback(uuid, uuid, uuid, uuid)') is null then raise exception '20261028400000: reassign_callback is missing'; end if;
  if to_regprocedure('public.release_callback_to_queue(uuid, uuid, uuid)') is null then raise exception '20261028400000: release_callback_to_queue is missing'; end if;
  if not exists (select 1 from pg_constraint where conname = 'callback_history_action_check' and pg_get_constraintdef(oid) like '%reassigned%') then
    raise exception '20261028400000: callback_history does not accept reassigned';
  end if;
end $$;

notify pgrst, 'reload schema';
