-- LA-1.10: transfer inbox and atomic claim.
-- lead_queue is LA-1.7's existing durable work-item primitive. Keep it as the single source of
-- truth instead of introducing a second work_items table that could diverge from intake.

alter table public.lead_queue
  add column if not exists submission_id uuid,
  add column if not exists owner_user_id uuid references public.users(id) on delete set null,
  add column if not exists owner_role text,
  add column if not exists queued_at timestamptz,
  add column if not exists disposition text,
  add column if not exists disposition_at timestamptz,
  add column if not exists disposition_by uuid references public.users(id) on delete set null;

update public.lead_queue q
set submission_id = l.submission_id,
    owner_user_id = coalesce(q.owner_user_id, q.claimed_by),
    queued_at = coalesce(q.queued_at, q.created_at)
from public.agent_leads l
where l.id = q.lead_id;

update public.lead_queue q
set owner_role = tu.role
from public.tenant_users tu
where tu.tenant_id = q.tenant_id
  and tu.user_id = q.owner_user_id
  and q.owner_role is null;

update public.lead_queue set queued_at = created_at where queued_at is null;
alter table public.lead_queue alter column queued_at set default now();
alter table public.lead_queue alter column queued_at set not null;

create index if not exists lead_queue_tenant_status_queued_idx
  on public.lead_queue (tenant_id, status, queued_at asc);
create index if not exists lead_queue_tenant_owner_idx
  on public.lead_queue (tenant_id, owner_user_id, queued_at desc)
  where owner_user_id is not null;
create index if not exists lead_queue_submission_idx
  on public.lead_queue (tenant_id, submission_id)
  where submission_id is not null;

-- Keep LA-1.7 callers that still write claimed_by compatible with the LA-1.10 names.
create or replace function public.sync_lead_queue_owner_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.owner_user_id is null and new.claimed_by is not null then
    new.owner_user_id := new.claimed_by;
  elsif new.claimed_by is null and new.owner_user_id is not null then
    new.claimed_by := new.owner_user_id;
  end if;
  if new.submission_id is null then
    select l.submission_id into new.submission_id from public.agent_leads l where l.id = new.lead_id;
  end if;
  if new.queued_at is null then new.queued_at := coalesce(new.created_at, now()); end if;
  return new;
end;
$$;

drop trigger if exists lead_queue_sync_owner_columns on public.lead_queue;
create trigger lead_queue_sync_owner_columns
before insert or update on public.lead_queue
for each row execute function public.sync_lead_queue_owner_columns();

create table if not exists public.verification_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  agent_role text not null check (agent_role in ('owner', 'producer')),
  status text not null default 'open' check (status in ('open', 'closed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open' and ended_at is null) or (status = 'closed' and ended_at is not null))
);

create unique index if not exists verification_sessions_active_idx
  on public.verification_sessions (work_item_id, user_id)
  where ended_at is null;
create index if not exists verification_sessions_tenant_idx
  on public.verification_sessions (tenant_id, started_at desc);

create table if not exists public.active_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  submission_id uuid,
  user_id uuid not null references public.users(id) on delete restrict,
  agent_role text not null check (agent_role in ('owner', 'producer')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists active_calls_open_item_user_idx
  on public.active_calls (work_item_id, user_id)
  where ended_at is null;
create index if not exists active_calls_tenant_open_idx
  on public.active_calls (tenant_id, started_at desc)
  where ended_at is null;

create table if not exists public.partner_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete restrict,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists partner_messages_tenant_partner_idx
  on public.partner_messages (tenant_id, partner_id, created_at desc);

create or replace function public.touch_la_1_10_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists verification_sessions_touch_updated_at on public.verification_sessions;
create trigger verification_sessions_touch_updated_at before update on public.verification_sessions
for each row execute function public.touch_la_1_10_updated_at();
drop trigger if exists active_calls_touch_updated_at on public.active_calls;
create trigger active_calls_touch_updated_at before update on public.active_calls
for each row execute function public.touch_la_1_10_updated_at();

alter table public.verification_sessions enable row level security;
alter table public.active_calls enable row level security;
alter table public.partner_messages enable row level security;

drop policy if exists verification_sessions_tenant_scoped on public.verification_sessions;
create policy verification_sessions_tenant_scoped on public.verification_sessions
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists active_calls_tenant_scoped on public.active_calls;
create policy active_calls_tenant_scoped on public.active_calls
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists partner_messages_tenant_scoped on public.partner_messages;
create policy partner_messages_tenant_scoped on public.partner_messages
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.verification_sessions, public.active_calls, public.partner_messages from anon, authenticated, public;
grant select on public.verification_sessions, public.active_calls, public.partner_messages to tenant_app;
grant select, insert, update on public.verification_sessions, public.active_calls, public.partner_messages to service_role;
revoke all on function public.sync_lead_queue_owner_columns() from public;
revoke all on function public.touch_la_1_10_updated_at() from public;

-- The claim transaction owns the facts that must agree: queue ownership, verification session and
-- active call. Chat is deliberately outside this function and is best effort in the route.
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
  on conflict (work_item_id, user_id) where ended_at is null
  do update set status = 'open', ended_at = null, updated_at = now()
  returning id into session_id;

  -- A dropped browser tab can leave a call open. Two hours is long enough for a genuine call,
  -- while making a later claim usable without a manual database repair.
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
