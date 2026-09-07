-- LA-1.14: self-claim buffer-agent flow.
-- The existing lead_queue, verification_sessions and active_calls rows remain the durable
-- primitives. A handoff is an offer layered over those rows; accepting it moves all three facts
-- in one locked transaction.

alter table public.lead_queue
  drop constraint if exists lead_queue_status_check;
alter table public.lead_queue
  add constraint lead_queue_status_check
  check (status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped'));

alter table public.verification_sessions
  drop constraint if exists verification_sessions_agent_role_check;
alter table public.verification_sessions
  add constraint verification_sessions_agent_role_check
  check (agent_role in ('owner', 'producer', 'assistant'));

alter table public.active_calls
  drop constraint if exists active_calls_agent_role_check;
alter table public.active_calls
  add constraint active_calls_agent_role_check
  check (agent_role in ('owner', 'producer', 'assistant'));

alter table public.lead_queue
  add column if not exists buffer_user_id uuid references public.users(id) on delete set null;

alter table public.partner_messages
  add column if not exists event_key text;
create unique index if not exists partner_messages_event_key_idx
  on public.partner_messages (event_key)
  where event_key is not null;

create table if not exists public.buffer_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  buffer_user_id uuid not null references public.users(id) on delete restrict,
  licensed_agent_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'returned')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (licensed_agent_id <> buffer_user_id),
  check ((status = 'pending' and accepted_at is null and returned_at is null)
      or (status = 'accepted' and accepted_at is not null and returned_at is null)
      or (status = 'returned' and returned_at is not null and accepted_at is null))
);

create unique index if not exists buffer_handoffs_pending_work_item_idx
  on public.buffer_handoffs (work_item_id)
  where status = 'pending';
create index if not exists buffer_handoffs_tenant_agent_idx
  on public.buffer_handoffs (tenant_id, licensed_agent_id, status, expires_at);

create or replace function public.touch_la_1_14_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists buffer_handoffs_touch_updated_at on public.buffer_handoffs;
create trigger buffer_handoffs_touch_updated_at
before update on public.buffer_handoffs
for each row execute function public.touch_la_1_14_updated_at();

alter table public.buffer_handoffs enable row level security;
drop policy if exists buffer_handoffs_tenant_scoped on public.buffer_handoffs;
create policy buffer_handoffs_tenant_scoped on public.buffer_handoffs
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.buffer_handoffs from anon, authenticated, public;
grant select on public.buffer_handoffs to tenant_app;
grant select, insert, update on public.buffer_handoffs to service_role;
revoke all on function public.touch_la_1_14_updated_at() from public;

-- Keep the existing claim endpoint, but resolve the role from the membership row and create the
-- buffer-specific state/session when that role is assistant. The request's role is only a
-- consistency check; it is never the authority.
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
  resolved_role text;
  claim_status text;
  violation_constraint text;
begin
  select tu.role::text into resolved_role
  from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
    and u.status = 'active';
  if resolved_role is null or resolved_role <> p_owner_role
     or resolved_role not in ('owner', 'producer', 'assistant') then
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
  claim_status := case when resolved_role = 'assistant' then 'buffer_active' else 'claimed' end;

  update public.lead_queue
  set status = claim_status,
      owner_user_id = p_user_id,
      claimed_by = p_user_id,
      owner_role = resolved_role,
      buffer_user_id = case when resolved_role = 'assistant' then p_user_id else null end,
      claimed_at = now()
  where id = item.id and tenant_id = p_tenant_id and status = 'unclaimed';

  insert into public.verification_sessions (tenant_id, work_item_id, lead_id, user_id, agent_role)
  values (p_tenant_id, item.id, item.lead_id, p_user_id, resolved_role)
  on conflict (work_item_id) where ended_at is null
  do update set user_id = excluded.user_id, agent_role = excluded.agent_role, status = 'open', ended_at = null, updated_at = now()
  returning id into session_id;

  update public.active_calls
  set ended_at = now(), updated_at = now()
  where work_item_id = item.id and ended_at is null and started_at < now() - interval '2 hours';

  begin
    insert into public.active_calls (tenant_id, work_item_id, lead_id, submission_id, user_id, agent_role)
    values (p_tenant_id, item.id, item.lead_id, resolved_submission_id, p_user_id, resolved_role)
    returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint = constraint_name;
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
    'owner_role', resolved_role,
    'status', claim_status,
    'claimed_at', (select claimed_at from public.lead_queue where id = item.id)
  );
end;
$$;

revoke all on function public.claim_transfer_lead(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_transfer_lead(uuid, uuid, uuid, text) to service_role;

create or replace function public.expire_buffer_handoffs(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  handoff_row public.buffer_handoffs%rowtype;
  expired_count integer := 0;
begin
  for handoff_row in
    select * from public.buffer_handoffs
    where tenant_id = p_tenant_id and status = 'pending' and expires_at <= now()
    for update
  loop
    update public.buffer_handoffs
    set status = 'returned', returned_at = now(), updated_at = now()
    where id = handoff_row.id;
    update public.lead_queue
    set status = 'buffer_active', updated_at = now()
    where id = handoff_row.work_item_id and tenant_id = p_tenant_id and status = 'handed_pending';
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', handoff_row.buffer_user_id, 'tenant.buffer_handoff_returned', 'buffer_handoff', handoff_row.id::text,
      jsonb_build_object('workItemId', handoff_row.work_item_id, 'reason', 'timeout'));
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

create or replace function public.offer_buffer_handoff(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_buffer_user_id uuid,
  p_target_user_id uuid,
  p_timeout_seconds integer default 30,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  queue_row public.lead_queue%rowtype;
  existing_handoff public.buffer_handoffs%rowtype;
  new_handoff public.buffer_handoffs%rowtype;
  buffer_role text;
  target_role text;
  session_exists boolean;
  call_exists boolean;
begin
  if p_timeout_seconds < 5 or p_timeout_seconds > 300 then
    raise exception using errcode = '22023', message = 'INVALID_HANDOFF_TIMEOUT';
  end if;
  select tu.role::text into buffer_role from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_buffer_user_id
    and u.status = 'active';
  if buffer_role <> 'assistant' then raise exception using errcode = '42501', message = 'BUFFER_ROLE_REQUIRED'; end if;
  select tu.role::text into target_role from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
    and u.status = 'active';
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;

  select * into queue_row from public.lead_queue
  where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if queue_row.status not in ('buffer_active', 'handed_pending') or queue_row.owner_user_id <> p_buffer_user_id then
    raise exception using errcode = '42501', message = 'BUFFER_OWNER_REQUIRED';
  end if;
  select exists (select 1 from public.verification_sessions where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into session_exists;
  if not session_exists then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  select exists (select 1 from public.active_calls where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into call_exists;
  if not call_exists then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;

  select * into existing_handoff from public.buffer_handoffs where work_item_id = p_work_item_id and status = 'pending' for update;
  if found then
    if existing_handoff.licensed_agent_id <> p_target_user_id then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    return jsonb_build_object('handoff_id', existing_handoff.id, 'status', existing_handoff.status, 'expires_at', existing_handoff.expires_at, 'idempotent', true);
  end if;
  if queue_row.status <> 'buffer_active' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;

  insert into public.buffer_handoffs (tenant_id, work_item_id, buffer_user_id, licensed_agent_id, expires_at)
  values (p_tenant_id, p_work_item_id, p_buffer_user_id, p_target_user_id, now() + make_interval(secs => p_timeout_seconds))
  returning * into new_handoff;
  update public.lead_queue set status = 'handed_pending', updated_at = now() where id = p_work_item_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_buffer_user_id, 'tenant.buffer_handoff_offered', 'buffer_handoff', new_handoff.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', p_work_item_id, 'licensedAgentId', p_target_user_id, 'expiresAt', new_handoff.expires_at));
  return jsonb_build_object('handoff_id', new_handoff.id, 'status', new_handoff.status, 'expires_at', new_handoff.expires_at, 'idempotent', false);
end;
$$;

create or replace function public.list_buffer_handoffs(p_tenant_id uuid, p_licensed_agent_id uuid)
returns table (
  id uuid,
  work_item_id uuid,
  buffer_user_id uuid,
  buffer_name text,
  product_line text,
  customer text,
  progress_percentage integer,
  verification_session_id uuid,
  offered_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.expire_buffer_handoffs(p_tenant_id);
  return query
  select h.id, h.work_item_id, h.buffer_user_id, u.name, q.product_line,
    coalesce(nullif(btrim(l.values ->> 'full_name'), ''), nullif(btrim(l.values ->> 'name'), ''), 'Unnamed customer'),
    s.progress_percentage, s.id, h.offered_at, h.expires_at
  from public.buffer_handoffs h
  join public.lead_queue q on q.id = h.work_item_id and q.tenant_id = h.tenant_id
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  join public.users u on u.id = h.buffer_user_id
  join public.verification_sessions s on s.work_item_id = h.work_item_id and s.tenant_id = h.tenant_id and s.ended_at is null
  where h.tenant_id = p_tenant_id and h.licensed_agent_id = p_licensed_agent_id and h.status = 'pending'
  order by h.offered_at asc;
end;
$$;

create or replace function public.accept_buffer_handoff(
  p_tenant_id uuid,
  p_handoff_id uuid,
  p_licensed_agent_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  handoff_row public.buffer_handoffs%rowtype;
  queue_row public.lead_queue%rowtype;
  session_row public.verification_sessions%rowtype;
  target_role text;
  call_count integer;
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
  select * into session_row from public.verification_sessions where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  update public.active_calls set user_id = p_licensed_agent_id, agent_role = target_role, updated_at = now()
  where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null;
  get diagnostics call_count = row_count;
  if call_count <> 1 then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  update public.verification_sessions set user_id = p_licensed_agent_id, agent_role = target_role, last_actor_id = p_licensed_agent_id, updated_at = now() where id = session_row.id;
  update public.lead_queue set status = 'la_active', owner_user_id = p_licensed_agent_id, claimed_by = p_licensed_agent_id, owner_role = target_role, updated_at = now() where id = queue_row.id;
  update public.buffer_handoffs set status = 'accepted', accepted_at = now(), updated_at = now() where id = handoff_row.id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_licensed_agent_id, 'tenant.buffer_handoff_accepted', 'buffer_handoff', handoff_row.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', queue_row.id, 'bufferUserId', handoff_row.buffer_user_id, 'progressPercentage', session_row.progress_percentage));
  return jsonb_build_object('handoff_id', handoff_row.id, 'work_item_id', queue_row.id, 'status', 'accepted', 'verification_session_id', session_row.id, 'progress_percentage', session_row.progress_percentage);
end;
$$;

revoke all on function public.expire_buffer_handoffs(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.list_buffer_handoffs(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.expire_buffer_handoffs(uuid) to service_role;
grant execute on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) to service_role;
grant execute on function public.list_buffer_handoffs(uuid, uuid) to service_role;
grant execute on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) to service_role;

-- Buffer agents verify the same dynamic form as licensed agents. The queue status is the
-- authorization state; ownership is still checked against the current session user.
create or replace function public.update_verification_field(
  p_tenant_id uuid, p_session_id uuid, p_work_item_id uuid, p_user_id uuid,
  p_field_key text, p_state text, p_new_value jsonb, p_required_keys text[], p_visible_keys text[],
  p_ip text default null, p_user_agent text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare session_row public.verification_sessions%rowtype; queue_row public.lead_queue%rowtype; lead_row public.agent_leads%rowtype; current_value jsonb; next_value jsonb; next_progress integer; field_exists boolean;
begin
  if p_state not in ('confirmed', 'corrected', 'outstanding') then raise exception using errcode='22023', message='INVALID_VERIFICATION_STATE'; end if;
  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]*$' then raise exception using errcode='22023', message='INVALID_FIELD_KEY'; end if;
  select * into session_row from public.verification_sessions where id=p_session_id and tenant_id=p_tenant_id and work_item_id=p_work_item_id and user_id=p_user_id and ended_at is null for update;
  if not found then raise exception using errcode='P0002', message='VERIFICATION_SESSION_NOT_FOUND'; end if;
  select * into queue_row from public.lead_queue where id=p_work_item_id and tenant_id=p_tenant_id and status in ('claimed','buffer_active','la_active') and owner_user_id=p_user_id for update;
  if not found then raise exception using errcode='42501', message='VERIFICATION_OWNER_REQUIRED'; end if;
  select * into lead_row from public.agent_leads where id=queue_row.lead_id and tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002', message='LEAD_NOT_FOUND'; end if;
  select exists(select 1 from public.verification_fields where session_id=p_session_id and field_key=p_field_key) into field_exists;
  if not field_exists then raise exception using errcode='P0002', message='VERIFICATION_FIELD_NOT_FOUND'; end if;
  current_value:=coalesce(lead_row.values -> p_field_key,'null'::jsonb);
  if p_state='corrected' then
    next_value:=p_new_value;
    update public.agent_leads set values=jsonb_set(lead_row.values,array[p_field_key],p_new_value,true),updated_at=now() where id=lead_row.id and tenant_id=p_tenant_id;
    insert into public.verification_field_changes(tenant_id,session_id,lead_id,field_key,old_value,new_value,actor_id) values(p_tenant_id,p_session_id,lead_row.id,p_field_key,current_value,next_value,p_user_id);
  elsif p_state='confirmed' then next_value:=current_value; else next_value:=null; end if;
  update public.verification_fields set is_required=field_key=any(coalesce(p_required_keys,array[]::text[])),is_visible=field_key=any(coalesce(p_visible_keys,array[]::text[])) where session_id=p_session_id;
  update public.verification_fields set state=p_state,old_value=case when p_state='outstanding' then old_value else current_value end,new_value=case when p_state='outstanding' then public.verification_fields.new_value else next_value end,confirmed_at=case when p_state='outstanding' then null else now() end,actor_id=p_user_id where session_id=p_session_id and field_key=p_field_key;
  select case when count(*) filter(where is_required and is_visible)=0 then 100 else round(100.0*count(*) filter(where is_required and is_visible and state in ('confirmed','corrected'))/count(*) filter(where is_required and is_visible))::integer end into next_progress from public.verification_fields where session_id=p_session_id;
  update public.verification_sessions set progress_percentage=next_progress,completed_at=case when next_progress=100 then coalesce(completed_at,now()) else null end,last_actor_id=p_user_id,updated_at=now() where id=p_session_id;
  insert into public.audit_log(actor_type,actor_id,action,target_type,target_id,ip,user_agent,metadata) values('tenant',p_user_id,'tenant.verification_field_updated','agent_lead',lead_row.id::text,p_ip,p_user_agent,jsonb_build_object('sessionId',p_session_id,'workItemId',p_work_item_id,'fieldKey',p_field_key,'state',p_state));
  return jsonb_build_object('session_id',p_session_id,'field_key',p_field_key,'state',p_state,'progress_percentage',next_progress,'completed_at',(select completed_at from public.verification_sessions where id=p_session_id));
end;
$$;
revoke all on function public.update_verification_field(uuid, uuid, uuid, uuid, text, text, jsonb, text[], text[], text, text) from public,anon,authenticated,tenant_app;
grant execute on function public.update_verification_field(uuid, uuid, uuid, uuid, text, text, jsonb, text[], text[], text, text) to service_role;
