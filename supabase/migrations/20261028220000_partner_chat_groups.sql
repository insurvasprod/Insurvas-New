-- Partner chat groups and per-person conversation state (owner, 2026-10-28).
--
-- 1. Group roles on partner_channel_members:
--    owner  - made the group; everything below, and cannot be removed;
--    admin  - adds and removes people, changes roles, renames the group;
--    member - writes; adds people only when can_add_members is on;
--    viewer - reads only.
--    A removed member keeps their row with removed_at set: chat history is never deleted by the
--    application (20260906120000), and re-adding them clears it.
-- 2. partner_channel_user_state: each person's own pin, archive and delete for a conversation.
--    "Delete" hides the conversation and its history for that person only; a newer message brings
--    the conversation back with only the messages after it.

alter table public.partner_channel_members
  add column if not exists role text not null default 'member',
  add column if not exists can_add_members boolean not null default false,
  add column if not exists added_by uuid references public.users(id) on delete set null,
  add column if not exists removed_at timestamptz;

alter table public.partner_channel_members drop constraint if exists partner_channel_members_role_check;
alter table public.partner_channel_members
  add constraint partner_channel_members_role_check check (role in ('owner', 'admin', 'member', 'viewer'));

-- Whoever made a group or direct conversation owns it.
update public.partner_channel_members m
   set role = 'owner'
  from public.partner_channels c
 where c.id = m.channel_id
   and c.created_by = m.user_id
   and m.role = 'member';

create table if not exists public.partner_channel_user_state (
  channel_id uuid not null references public.partner_channels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  pinned_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists partner_channel_user_state_tenant_user_idx
  on public.partner_channel_user_state (tenant_id, user_id);

alter table public.partner_channel_user_state enable row level security;

drop policy if exists partner_channel_user_state_own on public.partner_channel_user_state;
create policy partner_channel_user_state_own on public.partner_channel_user_state
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid)
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid);

revoke all on public.partner_channel_user_state from anon, authenticated, public;
grant select, insert, update on public.partner_channel_user_state to tenant_app;
grant select, insert, update on public.partner_channel_user_state to service_role;
-- The row is a person's view settings, never chat history: nothing deletes it but the cascade.
revoke delete, truncate on public.partner_channel_user_state from service_role;

notify pgrst, 'reload schema';
