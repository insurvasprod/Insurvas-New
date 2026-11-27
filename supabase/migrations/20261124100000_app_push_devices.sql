-- The phone app (2026-11-24) · push devices.
--
-- One row per phone that asked for push while signed in. The app registers its Expo push token after
-- sign-in (POST /api/app/push-devices); the server sends the bell's alerts to every live row of the
-- person in that workspace (lib/push/send.ts).
--
--   app_push_device   bound to the session row that registered it, so ending the session (sign out,
--                     Signed-in devices, sign out everywhere) stops push to that phone with it. A token
--                     that Expo reports as no longer registered is retired by the sender.
--
-- Written only by the service role from the app's routes; nobody reads it but the sender.
--
-- Also adds agent_notifications.push_handled_at, the push outbox's claim (as email_handled_at is email's).
--
-- Rollback: drop table public.app_push_device; alter table public.agent_notifications drop column push_handled_at;

create table if not exists public.app_push_device (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid references public.tenant_user_session(id) on delete cascade,
  token text not null check (length(token) between 10 and 300),
  platform text not null check (platform in ('ios', 'android')),
  device_label text check (device_label is null or length(device_label) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_reason text check (retired_reason is null or retired_reason in ('signed_out', 'session_ended', 'not_registered', 'replaced', 'turned_off')),
  constraint app_push_device_retired check ((retired_at is null) = (retired_reason is null))
);

-- A token lives on one phone; registering it again (another person on the same phone, another
-- workspace) moves it rather than sending one alert twice.
create unique index if not exists app_push_device_token_live on public.app_push_device (token) where retired_at is null;
create index if not exists app_push_device_user_live on public.app_push_device (user_id, tenant_id) where retired_at is null;
create index if not exists app_push_device_session on public.app_push_device (session_id);
create index if not exists app_push_device_tenant on public.app_push_device (tenant_id);

-- ─── the bell's push outbox (lib/push/outbox.ts) ─────────────────────────────────────────────────
-- Like email_handled_at: a bell row is claimed for push once. Rows that already exist are marked handled
-- so turning push on never buzzes a phone with yesterday's alerts.
alter table public.agent_notifications add column if not exists push_handled_at timestamptz;
update public.agent_notifications set push_handled_at = now() where push_handled_at is null;
create index if not exists agent_notifications_push_pending on public.agent_notifications (created_at) where push_handled_at is null;

-- ─── access ───────────────────────────────────────────────────────────────────────────────────
alter table public.app_push_device enable row level security;
revoke all on public.app_push_device from public, anon, authenticated;
grant select, insert, update on public.app_push_device to service_role;
-- Supabase grants the service role everything by default; rows are retired, never deleted.
revoke delete, truncate on public.app_push_device from service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.app_push_device', 'delete')
     or has_table_privilege('service_role', 'public.app_push_device', 'truncate') then
    raise exception 'app_push_device: service_role must not hold delete or truncate';
  end if;
end;
$$;
