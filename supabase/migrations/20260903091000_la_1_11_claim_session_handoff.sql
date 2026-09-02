-- LA-1.11: an open verification session belongs to the work item. A later claimant resumes it.
-- This forward replacement preserves LA-1.10's atomic claim and active-call behavior while
-- changing the conflict key from (work_item_id, user_id) to work_item_id.
create or replace function public.claim_transfer_lead(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_user_id uuid,
  p_owner_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  item public.lead_queue%rowtype;
  session_id uuid;
  call_id uuid;
  resolved_submission_id uuid;
  violation_constraint text;
begin
  if p_owner_role not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  select q.* into item
  from public.lead_queue q
  where q.id = p_work_item_id and q.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND';
  end if;

  if item.status <> 'unclaimed' then
    raise exception using errcode = 'P0001', message = 'ALREADY_CLAIMED', detail = coalesce(item.owner_user_id::text, item.claimed_by::text, 'unknown');
  end if;

  select l.submission_id into resolved_submission_id
  from public.agent_leads l
  where l.id = item.lead_id and l.tenant_id = p_tenant_id;

  update public.lead_queue
  set status = 'claimed',
      owner_user_id = p_user_id,
      claimed_by = p_user_id,
      owner_role = p_owner_role,
      claimed_at = now()
  where id = item.id and tenant_id = p_tenant_id and status = 'unclaimed';

  insert into public.verification_sessions (tenant_id, work_item_id, lead_id, user_id, agent_role)
  values (p_tenant_id, item.id, item.lead_id, p_user_id, p_owner_role)
  on conflict (work_item_id) where ended_at is null
  do update set status = 'open', ended_at = null, user_id = p_user_id, agent_role = p_owner_role, updated_at = now()
  returning id into session_id;

  update public.active_calls
  set ended_at = now(), updated_at = now()
  where work_item_id = item.id and ended_at is null and started_at < now() - interval '2 hours';

  begin
    insert into public.active_calls (tenant_id, work_item_id, lead_id, submission_id, user_id, agent_role)
    values (p_tenant_id, item.id, item.lead_id, resolved_submission_id, p_user_id, p_owner_role)
    returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint = CONSTRAINT_NAME;
    if violation_constraint <> 'active_calls_open_item_user_idx' then raise; end if;
    select id into call_id from public.active_calls
    where work_item_id = item.id and user_id = p_user_id and ended_at is null;
    if call_id is null then raise; end if;
  end;

  return jsonb_build_object(
    'work_item_id', item.id,
    'lead_id', item.lead_id,
    'submission_id', resolved_submission_id,
    'verification_session_id', session_id,
    'active_call_id', call_id,
    'owner_user_id', p_user_id,
    'claimed_at', (select claimed_at from public.lead_queue where id = item.id)
  );
end;
$$;

revoke all on function public.claim_transfer_lead(uuid, uuid, uuid, text) from public;
revoke all on function public.claim_transfer_lead(uuid, uuid, uuid, text) from anon, authenticated, tenant_app;
grant execute on function public.claim_transfer_lead(uuid, uuid, uuid, text) to service_role;
