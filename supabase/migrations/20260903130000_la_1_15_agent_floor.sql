-- LA-1.15: Agent Floor presence, nudge audit trail, and tenant-scoped realtime signals.
-- The floor reads lead_queue and active_calls directly: an open active_calls row is the only
-- evidence that a person is on a live call. These tables add availability and an auditable,
-- idempotent nudge record without copying plan or call state into a second source of truth.

create table if not exists public.agent_presence (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'off' check (status in ('ready', 'on_call', 'on_break', 'off')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists agent_presence_tenant_seen_idx
  on public.agent_presence (tenant_id, last_seen_at desc);

create table if not exists public.agent_floor_nudges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  target_user_id uuid references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  message text not null default 'Please pick up the waiting transfer.' check (char_length(message) between 1 and 240),
  created_at timestamptz not null default now()
);

create unique index if not exists agent_floor_nudges_idempotency_idx
  on public.agent_floor_nudges (tenant_id, created_by, idempotency_key);
create index if not exists agent_floor_nudges_work_item_idx
  on public.agent_floor_nudges (tenant_id, work_item_id, created_at desc);

create or replace function public.touch_la_1_15_presence_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_presence_touch_updated_at on public.agent_presence;
create trigger agent_presence_touch_updated_at
before update on public.agent_presence
for each row execute function public.touch_la_1_15_presence_updated_at();

-- Broadcast only a tenant-scoped invalidation signal. No names, phone numbers, lead data, or
-- session data leave Postgres. The subsequent floor GET is still authenticated and tenant-scoped.
create or replace function public.broadcast_la_1_15_floor_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  floor_tenant_id uuid;
begin
  floor_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  perform realtime.send(
    jsonb_build_object('tenant_id', floor_tenant_id),
    'floor_changed',
    'agent-floor:' || floor_tenant_id::text,
    false
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists lead_queue_floor_broadcast on public.lead_queue;
create trigger lead_queue_floor_broadcast
after insert or update or delete on public.lead_queue
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists active_calls_floor_broadcast on public.active_calls;
create trigger active_calls_floor_broadcast
after insert or update or delete on public.active_calls
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists buffer_handoffs_floor_broadcast on public.buffer_handoffs;
create trigger buffer_handoffs_floor_broadcast
after insert or update or delete on public.buffer_handoffs
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists agent_presence_floor_broadcast on public.agent_presence;
create trigger agent_presence_floor_broadcast
after insert or update or delete on public.agent_presence
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists agent_floor_nudges_broadcast on public.agent_floor_nudges;
create trigger agent_floor_nudges_broadcast
after insert or update or delete on public.agent_floor_nudges
for each row execute function public.broadcast_la_1_15_floor_change();

alter table public.agent_presence enable row level security;
drop policy if exists agent_presence_tenant_scoped on public.agent_presence;
create policy agent_presence_tenant_scoped on public.agent_presence
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

alter table public.agent_floor_nudges enable row level security;
drop policy if exists agent_floor_nudges_tenant_scoped on public.agent_floor_nudges;
create policy agent_floor_nudges_tenant_scoped on public.agent_floor_nudges
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.agent_presence from anon, authenticated, public;
grant select, insert, update on public.agent_presence to tenant_app;
grant select, insert, update, delete on public.agent_presence to service_role;

revoke all on public.agent_floor_nudges from anon, authenticated, public;
grant select, insert on public.agent_floor_nudges to tenant_app;
grant select, insert, delete on public.agent_floor_nudges to service_role;

revoke all on function public.touch_la_1_15_presence_updated_at() from public;
revoke all on function public.broadcast_la_1_15_floor_change() from public;

