-- LA-1.16: explicit membership for agent-created channels and private chat files.
-- The automatic partner channel continues to be scoped by partner_id. Agent-created
-- direct/group channels are scoped by partner_channel_members instead.

alter table public.partner_channels
  alter column partner_id drop not null;

alter table public.partner_messages
  alter column partner_id drop not null;

alter table public.partner_channels
  drop constraint if exists partner_channels_channel_type_check;
alter table public.partner_channels
  add constraint partner_channels_channel_type_check
  check (channel_type in ('partner', 'direct', 'group'));

alter table public.partner_channels
  add column if not exists direct_key text;

create unique index if not exists partner_channels_direct_key_idx
  on public.partner_channels (tenant_id, direct_key)
  where channel_type = 'direct' and direct_key is not null;

create table if not exists public.partner_channel_members (
  channel_id uuid not null references public.partner_channels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists partner_channel_members_tenant_user_idx
  on public.partner_channel_members (tenant_id, user_id, created_at desc);

create index if not exists partner_channel_members_tenant_channel_idx
  on public.partner_channel_members (tenant_id, channel_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-chat-attachments',
  'partner-chat-attachments',
  false,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.partner_channel_members enable row level security;

drop policy if exists partner_channel_members_tenant_scoped on public.partner_channel_members;
create policy partner_channel_members_tenant_scoped on public.partner_channel_members
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid)
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.partner_channel_members from anon, authenticated, public;
grant select, insert, update on public.partner_channel_members to tenant_app;
grant select, insert, update on public.partner_channel_members to service_role;
-- Service-role cleanup is limited to a channel whose participant insert failed;
-- user-facing chat history is never deleted by the application.
grant delete on public.partner_channels to service_role;
