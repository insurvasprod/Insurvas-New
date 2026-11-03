-- LA-1.21: plain-text lead notes with explicit internal/shared visibility.
-- The note row is never physically deleted: deleted_at is the timeline tombstone.

create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  visibility text not null default 'internal' check (visibility in ('internal', 'shared')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create table if not exists public.lead_note_edits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  note_id uuid not null references public.lead_notes(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('edited', 'visibility_changed', 'deleted')),
  old_body text not null,
  old_visibility text not null check (old_visibility in ('internal', 'shared')),
  new_body text,
  new_visibility text check (new_visibility is null or new_visibility in ('internal', 'shared')),
  created_at timestamptz not null default now()
);

create table if not exists public.agent_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 1 and 80),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  link text not null check (char_length(btrim(link)) between 1 and 500),
  source_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (tenant_id, recipient_user_id, source_key)
);

create table if not exists public.lead_note_mentions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  note_id uuid not null references public.lead_notes(id) on delete cascade,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, mentioned_user_id)
);

create index if not exists lead_notes_tenant_lead_created_idx on public.lead_notes (tenant_id, lead_id, created_at desc);
create index if not exists lead_notes_search_idx on public.lead_notes using gin (to_tsvector('simple', body)) where deleted_at is null;
create index if not exists lead_note_edits_note_created_idx on public.lead_note_edits (tenant_id, note_id, created_at asc);
create index if not exists agent_notifications_recipient_idx on public.agent_notifications (tenant_id, recipient_user_id, created_at desc) where read_at is null;
create index if not exists lead_note_mentions_user_idx on public.lead_note_mentions (tenant_id, mentioned_user_id, created_at desc);

alter table public.lead_notes enable row level security;
alter table public.lead_note_edits enable row level security;
alter table public.agent_notifications enable row level security;
alter table public.lead_note_mentions enable row level security;

drop policy if exists lead_notes_tenant_scoped on public.lead_notes;
create policy lead_notes_tenant_scoped on public.lead_notes
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists lead_note_edits_tenant_scoped on public.lead_note_edits;
create policy lead_note_edits_tenant_scoped on public.lead_note_edits
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists agent_notifications_user_scoped on public.agent_notifications;
create policy agent_notifications_user_scoped on public.agent_notifications
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    and recipient_user_id = nullif((select current_setting('app.user_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    and recipient_user_id = nullif((select current_setting('app.user_id', true)), '')::uuid);

drop policy if exists lead_note_mentions_tenant_scoped on public.lead_note_mentions;
create policy lead_note_mentions_tenant_scoped on public.lead_note_mentions
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.lead_notes, public.lead_note_edits, public.lead_note_mentions, public.agent_notifications from anon, authenticated, public;
grant select on public.lead_notes, public.lead_note_edits to tenant_app;
grant select on public.lead_note_mentions to tenant_app;
grant select, insert, update on public.agent_notifications to tenant_app;
grant select, insert, update on public.lead_notes, public.lead_note_edits, public.lead_note_mentions, public.agent_notifications to service_role;

-- A notification is a durable, immediately-visible event; Realtime makes the UI receive it
-- without polling while the row remains the source of truth for reconnects.
create or replace function public.broadcast_agent_notification()
returns trigger security definer set search_path = public, pg_catalog
as $$
begin
  perform realtime.broadcast_changes(
    'agent-notifications:' || new.tenant_id::text || ':' || new.recipient_user_id::text,
    'notification', 'INSERT', 'agent_notifications', 'public',
    jsonb_build_object('notification_id', new.id), null
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_notifications_broadcast on public.agent_notifications;
create trigger agent_notifications_broadcast after insert on public.agent_notifications
for each row execute function public.broadcast_agent_notification();

revoke all on function public.broadcast_agent_notification() from public, anon, authenticated, tenant_app;
