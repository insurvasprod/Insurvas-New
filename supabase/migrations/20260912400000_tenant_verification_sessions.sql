-- Give this application's verification sessions their own table.
--
-- public.verification_sessions belongs to the organizations-era CRM. Its shape says so plainly:
--
--   submission_id  text NOT NULL, UNIQUE, REFERENCES leads(submission_id) ON DELETE CASCADE
--   status         CHECK in pending, in_progress, ready_for_transfer, transferred, completed,
--                  call_dropped, buffer_done, la_done
--
-- This repository declares the same name in 20260902230000 with lead_id NOT NULL referencing
-- public.agent_leads, no submission_id at all, and status in ('open','closed'). That
-- `create table if not exists` silently no-opped against the CRM's table, exactly as it did for
-- public.pipelines, and the mismatch stayed invisible until something tried to write.
--
-- The collision is not reconcilable by widening. submission_id is NOT NULL and points at
-- public.leads, and this application's leads live in public.agent_leads -- so there is no value it
-- can write that satisfies the foreign key. Not a vocabulary difference; a different table.
--
-- What it costs today: claim_transfer_lead creates a verification session at claim, so the insert
-- raises 23502 and /api/app/inbound/claim answers 500. Claiming a transfer is impossible. That one
-- defect fails six LA-1.10 checks, blocks LA-1.11 entirely (its suite cannot get a claimant), and
-- fails four LA-1.20 checks. The route's generic error branch discards error.message, which is why
-- it took a database query rather than a log line to find.
--
-- Following SA-3 and 20260912270000: this application's table moves, the CRM's does not.
-- tenant_verification_sessions is created from this repository's own declaration.
--
-- verification_fields is OURS already -- its columns match 20260903090000 exactly -- so it is kept
-- and its session_id foreign key is repointed at the new table. Both tables hold zero rows, so
-- nothing is migrated and nothing can be lost. public.verification_items is the CRM's sibling and
-- is not touched.
--
-- Six functions are re-pointed below. The seventh that touches verification_sessions,
-- update_verification_item, is the CRM's and is left alone.

create table if not exists public.tenant_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  agent_role text not null check (agent_role in ('owner', 'producer', 'assistant')),
  status text not null default 'open' check (status in ('open', 'closed')),
  progress_percentage integer not null default 0 check (progress_percentage between 0 and 100),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open' and ended_at is null) or (status = 'closed' and ended_at is not null))
);

-- The partial unique indexes the claim path relies on: one open session per work item, and the
-- per-user variant the buffer handoff uses.
create unique index if not exists tenant_verification_sessions_active_work_item_idx
  on public.tenant_verification_sessions (work_item_id) where ended_at is null;
create unique index if not exists tenant_verification_sessions_active_idx
  on public.tenant_verification_sessions (work_item_id, user_id) where ended_at is null;

alter table public.tenant_verification_sessions enable row level security;

drop policy if exists tenant_verification_sessions_tenant_scoped on public.tenant_verification_sessions;
create policy tenant_verification_sessions_tenant_scoped on public.tenant_verification_sessions for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_verification_sessions from anon, authenticated, public;
grant select on public.tenant_verification_sessions to tenant_app;
grant select, insert, update, delete on public.tenant_verification_sessions to service_role;

-- verification_fields is this repository's table and keeps its name; only its parent moves.
alter table public.verification_fields drop constraint if exists verification_fields_session_id_fkey;
alter table public.verification_fields
  add constraint verification_fields_session_id_fkey
  foreign key (session_id) references public.tenant_verification_sessions(id) on delete cascade;


-- claim_transfer_lead: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.claim_transfer_lead(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_owner_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare item public.lead_queue%rowtype; session_id uuid; call_id uuid; resolved_submission_id uuid; resolved_role text; claim_status text; violation_constraint text;
begin
  select tu.role::text into resolved_role from public.tenant_users tu join public.users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.user_id=p_user_id and u.status='active';
  if resolved_role is null or resolved_role <> p_owner_role or resolved_role not in ('owner','producer','assistant') then raise exception using errcode='42501',message='ROLE_NOT_ALLOWED'; end if;
  select q.* into item from public.lead_queue q where q.id=p_work_item_id and q.tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='WORK_ITEM_NOT_FOUND'; end if;
  if item.status <> 'unclaimed' then raise exception using errcode='P0001',message='ALREADY_CLAIMED',detail=coalesce(item.owner_user_id::text,item.claimed_by::text,'unknown'); end if;
  select l.submission_id into resolved_submission_id from public.agent_leads l where l.id=item.lead_id and l.tenant_id=p_tenant_id;
  claim_status:=case when resolved_role='assistant' then 'buffer_active' else 'claimed' end;
  update public.lead_queue set status=claim_status,owner_user_id=p_user_id,claimed_by=p_user_id,owner_role=resolved_role,buffer_user_id=case when resolved_role='assistant' then p_user_id else null end,claimed_at=now() where id=item.id and tenant_id=p_tenant_id and status='unclaimed';
  insert into public.tenant_verification_sessions(tenant_id,work_item_id,lead_id,user_id,agent_role) values(p_tenant_id,item.id,item.lead_id,p_user_id,resolved_role)
    on conflict(work_item_id) where ended_at is null do update set user_id=excluded.user_id,agent_role=excluded.agent_role,status='open',ended_at=null,updated_at=now() returning id into session_id;
  update public.active_calls set ended_at=now(),updated_at=now() where work_item_id=item.id and ended_at is null and started_at<now()-interval '2 hours';
  begin
    insert into public.active_calls(tenant_id,work_item_id,lead_id,submission_id,user_id,agent_role) values(p_tenant_id,item.id,item.lead_id,resolved_submission_id,p_user_id,resolved_role) returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint=constraint_name;
    if violation_constraint<>'active_calls_open_item_user_idx' then raise; end if;
    select id into call_id from public.active_calls where work_item_id=item.id and user_id=p_user_id and ended_at is null;
    if call_id is null then raise; end if;
  end;
  return jsonb_build_object('work_item_id',item.id,'lead_id',item.lead_id,'submission_id',resolved_submission_id,'verification_session_id',session_id,'active_call_id',call_id,'owner_user_id',p_user_id,'owner_role',resolved_role,'status',claim_status,'claimed_at',(select claimed_at from public.lead_queue where id=item.id));
end;
$function$
;

-- update_verification_progress: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.update_verification_progress()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare sid uuid;
begin
  sid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  update public.tenant_verification_sessions set
    verified_fields = (select count(*)::int from public.verification_items where session_id = sid and is_verified),
    total_fields = (select count(*)::int from public.verification_items where session_id = sid),
    progress_percentage = case when (select count(*) from public.verification_items where session_id = sid) = 0 then 0 else round(100.0 * (select count(*) from public.verification_items where session_id = sid and is_verified) / (select count(*) from public.verification_items where session_id = sid))::int end,
    updated_at = now() where id = sid;
  return coalesce(new, old);
end;
$function$
;

-- update_verification_field: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.update_verification_field(p_tenant_id uuid, p_session_id uuid, p_work_item_id uuid, p_user_id uuid, p_field_key text, p_state text, p_new_value jsonb, p_required_keys text[], p_visible_keys text[], p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare session_row public.tenant_verification_sessions%rowtype; queue_row public.lead_queue%rowtype; lead_row public.agent_leads%rowtype; current_value jsonb; next_value jsonb; next_progress integer; field_exists boolean;
begin
  if p_state not in ('confirmed','corrected','outstanding') then raise exception using errcode='22023',message='INVALID_VERIFICATION_STATE'; end if;
  if p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]*$' then raise exception using errcode='22023',message='INVALID_FIELD_KEY'; end if;
  select * into session_row from public.tenant_verification_sessions where id=p_session_id and tenant_id=p_tenant_id and work_item_id=p_work_item_id and user_id=p_user_id and ended_at is null for update;
  if not found then raise exception using errcode='P0002',message='VERIFICATION_SESSION_NOT_FOUND'; end if;
  select * into queue_row from public.lead_queue where id=p_work_item_id and tenant_id=p_tenant_id and status in ('claimed','buffer_active','la_active') and owner_user_id=p_user_id for update;
  if not found then raise exception using errcode='42501',message='VERIFICATION_OWNER_REQUIRED'; end if;
  select * into lead_row from public.agent_leads where id=queue_row.lead_id and tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='LEAD_NOT_FOUND'; end if;
  select exists(select 1 from public.verification_fields where session_id=p_session_id and field_key=p_field_key) into field_exists;
  if not field_exists then raise exception using errcode='P0002',message='VERIFICATION_FIELD_NOT_FOUND'; end if;
  current_value:=coalesce(lead_row.values -> p_field_key,'null'::jsonb);
  if p_state='corrected' then
    next_value:=p_new_value;
    update public.agent_leads set values=jsonb_set(lead_row.values,array[p_field_key],p_new_value,true),updated_at=now() where id=lead_row.id and tenant_id=p_tenant_id;
    insert into public.verification_field_changes(tenant_id,session_id,lead_id,field_key,old_value,new_value,actor_id) values(p_tenant_id,p_session_id,lead_row.id,p_field_key,current_value,next_value,p_user_id);
  elsif p_state='confirmed' then next_value:=current_value; else next_value:=null; end if;
  update public.verification_fields set is_required=field_key=any(coalesce(p_required_keys,array[]::text[])),is_visible=field_key=any(coalesce(p_visible_keys,array[]::text[])) where session_id=p_session_id;
  update public.verification_fields set state=p_state,old_value=case when p_state='outstanding' then old_value else current_value end,new_value=case when p_state='outstanding' then public.verification_fields.new_value else next_value end,confirmed_at=case when p_state='outstanding' then null else now() end,actor_id=p_user_id where session_id=p_session_id and field_key=p_field_key;
  select case when count(*) filter(where is_required and is_visible)=0 then 100 else round(100.0*count(*) filter(where is_required and is_visible and state in ('confirmed','corrected'))/count(*) filter(where is_required and is_visible))::integer end into next_progress from public.verification_fields where session_id=p_session_id;
  update public.tenant_verification_sessions set progress_percentage=next_progress,completed_at=case when next_progress=100 then coalesce(completed_at,now()) else null end,last_actor_id=p_user_id,updated_at=now() where id=p_session_id;
  insert into public.audit_log(actor_type,actor_id,action,target_type,target_id,ip,user_agent,metadata) values('tenant',p_user_id,'tenant.verification_field_updated','agent_lead',lead_row.id::text,p_ip,p_user_agent,jsonb_build_object('sessionId',p_session_id,'workItemId',p_work_item_id,'fieldKey',p_field_key,'state',p_state));
  return jsonb_build_object('session_id',p_session_id,'field_key',p_field_key,'state',p_state,'progress_percentage',next_progress,'completed_at',(select completed_at from public.tenant_verification_sessions where id=p_session_id));
end;
$function$
;

-- initialize_verification_items: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.initialize_verification_items(session_id_param uuid, submission_id_param text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare lead_row public.leads%rowtype;
begin
  if not private.can_operate_verification(submission_id_param) then raise exception 'Not authorized to initialize verification'; end if;
  select * into lead_row from public.leads where submission_id = submission_id_param;
  if lead_row.id is null then raise exception 'Lead not found'; end if;
  if not exists (select 1 from public.tenant_verification_sessions where id = session_id_param and submission_id = submission_id_param) then raise exception 'Verification session does not match lead'; end if;
  insert into public.verification_items (session_id, field_name, field_category, original_value)
  values
    (session_id_param, 'customer_full_name', 'personal', trim(concat(lead_row.first_name, ' ', lead_row.last_name))),
    (session_id_param, 'email', 'contact', lead_row.email),
    (session_id_param, 'phone_number', 'contact', lead_row.phone),
    (session_id_param, 'product_line', 'insurance', lead_row.product_line),
    (session_id_param, 'additional_notes', 'additional', lead_row.notes)
  on conflict (session_id, field_name) do update set original_value = excluded.original_value, updated_at = now();
  update public.tenant_verification_sessions set total_fields = (select count(*)::int from public.verification_items where session_id = session_id_param) where id = session_id_param;
end;
$function$
;

-- offer_buffer_handoff: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.offer_buffer_handoff(p_tenant_id uuid, p_work_item_id uuid, p_buffer_user_id uuid, p_target_user_id uuid, p_timeout_seconds integer DEFAULT 30, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare queue_row public.lead_queue%rowtype; existing_handoff public.buffer_handoffs%rowtype; new_handoff public.buffer_handoffs%rowtype; buffer_role text; target_role text; session_exists boolean; call_exists boolean;
begin
  if p_timeout_seconds<5 or p_timeout_seconds>300 then raise exception using errcode='22023',message='INVALID_HANDOFF_TIMEOUT'; end if;
  select tu.role::text into buffer_role from public.tenant_users tu join public.users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.user_id=p_buffer_user_id and u.status='active';
  if buffer_role <> 'assistant' then raise exception using errcode='42501',message='BUFFER_ROLE_REQUIRED'; end if;
  select tu.role::text into target_role from public.tenant_users tu join public.users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.user_id=p_target_user_id and u.status='active';
  if target_role not in ('owner','producer') then raise exception using errcode='42501',message='LICENSED_AGENT_REQUIRED'; end if;
  select * into queue_row from public.lead_queue where id=p_work_item_id and tenant_id=p_tenant_id for update;
  if not found then raise exception using errcode='P0002',message='WORK_ITEM_NOT_FOUND'; end if;
  if queue_row.status not in ('buffer_active','handed_pending') or queue_row.owner_user_id <> p_buffer_user_id then raise exception using errcode='42501',message='BUFFER_OWNER_REQUIRED'; end if;
  select * into existing_handoff from public.buffer_handoffs where work_item_id=p_work_item_id and status='pending' for update;
  if found then
    if existing_handoff.licensed_agent_id <> p_target_user_id then raise exception using errcode='P0001',message='HANDOFF_PENDING'; end if;
    return jsonb_build_object('handoff_id',existing_handoff.id,'status',existing_handoff.status,'expires_at',existing_handoff.expires_at,'idempotent',true);
  end if;
  if queue_row.status <> 'buffer_active' then raise exception using errcode='P0001',message='HANDOFF_PENDING'; end if;
  select exists(select 1 from public.tenant_verification_sessions where work_item_id=p_work_item_id and tenant_id=p_tenant_id and user_id=p_buffer_user_id and ended_at is null) into session_exists;
  if not session_exists then raise exception using errcode='P0002',message='VERIFICATION_SESSION_NOT_FOUND'; end if;
  select exists(select 1 from public.active_calls where work_item_id=p_work_item_id and tenant_id=p_tenant_id and user_id=p_buffer_user_id and ended_at is null) into call_exists;
  if not call_exists then raise exception using errcode='P0002',message='ACTIVE_CALL_NOT_FOUND'; end if;
  insert into public.buffer_handoffs(tenant_id,work_item_id,buffer_user_id,licensed_agent_id,expires_at) values(p_tenant_id,p_work_item_id,p_buffer_user_id,p_target_user_id,now()+make_interval(secs=>p_timeout_seconds)) returning * into new_handoff;
  update public.lead_queue set status='handed_pending',updated_at=now() where id=p_work_item_id;
  insert into public.audit_log(actor_type,actor_id,action,target_type,target_id,ip,user_agent,metadata) values('tenant',p_buffer_user_id,'tenant.buffer_handoff_offered','buffer_handoff',new_handoff.id::text,p_ip,p_user_agent,jsonb_build_object('workItemId',p_work_item_id,'licensedAgentId',p_target_user_id,'expiresAt',new_handoff.expires_at));
  return jsonb_build_object('handoff_id',new_handoff.id,'status',new_handoff.status,'expires_at',new_handoff.expires_at,'idempotent',false);
end;
$function$
;

-- accept_buffer_handoff: repointed at tenant_verification_sessions, otherwise the live definition verbatim.
CREATE OR REPLACE FUNCTION public.accept_buffer_handoff(p_tenant_id uuid, p_handoff_id uuid, p_licensed_agent_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  handoff_row public.buffer_handoffs%rowtype;
  queue_row public.lead_queue%rowtype;
  session_row public.tenant_verification_sessions%rowtype;
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
  select * into session_row from public.tenant_verification_sessions where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  update public.active_calls set user_id = p_licensed_agent_id, agent_role = target_role, updated_at = now()
  where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null;
  get diagnostics call_count = row_count;
  if call_count <> 1 then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  update public.tenant_verification_sessions set user_id = p_licensed_agent_id, agent_role = target_role, last_actor_id = p_licensed_agent_id, updated_at = now() where id = session_row.id;
  update public.lead_queue set status = 'la_active', owner_user_id = p_licensed_agent_id, claimed_by = p_licensed_agent_id, owner_role = target_role, updated_at = now() where id = queue_row.id;
  update public.buffer_handoffs set status = 'accepted', accepted_at = now(), updated_at = now() where id = handoff_row.id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_licensed_agent_id, 'tenant.buffer_handoff_accepted', 'buffer_handoff', handoff_row.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', queue_row.id, 'bufferUserId', handoff_row.buffer_user_id, 'progressPercentage', session_row.progress_percentage));
  return jsonb_build_object('handoff_id', handoff_row.id, 'work_item_id', queue_row.id, 'status', 'accepted', 'verification_session_id', session_row.id, 'progress_percentage', session_row.progress_percentage);
end;
$function$
;
