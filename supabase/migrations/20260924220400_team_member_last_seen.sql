-- Settings › Team & access: "Last seen — Now, 4 min ago, 1 hr ago".
--
-- The product could only show users.last_login_at, the last successful sign-in, which says nothing
-- about whether someone is working now: a producer who signed in on Monday and has dialled all week
-- read "4 days ago". agent_presence.last_seen_at is written by the Agent Floor heartbeat only, and
-- every write to it broadcasts a floor refresh, so it cannot double as a general activity stamp.
--
-- This is that stamp: one row per member, touched by the alert-feed poll every signed-in agent tab
-- already makes (GET /api/app/notifications, every few seconds). The application throttles it to at
-- most one write per member per minute per server, and the function below refuses a write inside
-- the same minute, so a dozen open tabs still cost one small UPDATE a minute. A table of its own
-- rather than a column on tenant_users so this write never fires the membership triggers.
--
-- Additive and idempotent. The team screen reads last sign-in until this is applied.

create table if not exists public.tenant_member_activity (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists tenant_member_activity_user_idx on public.tenant_member_activity (user_id);

alter table public.tenant_member_activity enable row level security;
revoke all on public.tenant_member_activity from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_member_activity to service_role;
grant select on public.tenant_member_activity to tenant_app;
drop policy if exists tenant_member_activity_read on public.tenant_member_activity;
create policy tenant_member_activity_read on public.tenant_member_activity
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Stamps a member as seen now, unless they were stamped in the last minute. Only for a real member
-- of that tenant, so a stale session for a removed person cannot write a row.
create or replace function public.touch_tenant_member_activity(p_tenant_id uuid, p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.tenant_member_activity as a (tenant_id, user_id, last_seen_at)
  select p_tenant_id, p_user_id, now()
   where exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id)
  on conflict (tenant_id, user_id) do update set last_seen_at = excluded.last_seen_at
   where a.last_seen_at < excluded.last_seen_at - interval '1 minute';
$$;

revoke all on function public.touch_tenant_member_activity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.touch_tenant_member_activity(uuid, uuid) to service_role;
