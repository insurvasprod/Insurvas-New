create or replace function public.start_disposition_walk(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_item public.lead_queue; v_flow public.disposition_flows; v_walk public.disposition_walks;
begin
  select q.* into v_item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id for update;
  if not found then raise exception 'DISPOSITION_WORK_ITEM_NOT_FOUND'; end if;
  if v_item.owner_user_id <> p_user_id or v_item.status not in ('claimed','completed','dropped') then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;
  select f.* into v_flow from public.disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = v_item.stage_id and f.is_active;
  if not found then raise exception 'DISPOSITION_FLOW_NOT_FOUND'; end if;
  select w.* into v_walk from public.disposition_walks w where w.tenant_id = p_tenant_id and w.work_item_id = p_work_item_id for update;
  if not found then
    insert into public.disposition_walks (tenant_id, work_item_id, lead_id, flow_id, user_id, current_node_id)
    values (p_tenant_id, p_work_item_id, v_item.lead_id, v_flow.id, p_user_id, v_flow.root_node_id) returning * into v_walk;
  else
    if v_walk.flow_id <> v_flow.id then raise exception 'DISPOSITION_FLOW_CHANGED'; end if;
    update public.disposition_walks set user_id = p_user_id, updated_at = now() where id = v_walk.id returning * into v_walk;
  end if;
  return jsonb_build_object('walk_id', v_walk.id, 'flow_id', v_walk.flow_id, 'current_node_id', v_walk.current_node_id, 'status', v_walk.status, 'final_disposition_key', v_walk.final_disposition_key);
end;
$$;
revoke all on function public.start_disposition_walk(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.start_disposition_walk(uuid, uuid, uuid) to service_role;
