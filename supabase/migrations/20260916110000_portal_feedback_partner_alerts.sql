-- Durable Partner Portal alerts. The browser only receives these through the authenticated
-- route handler; no direct client grants expose another partner's operational activity.
create table if not exists public.partner_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('partner_message', 'lead_status_changed', 'partner_account_changed', 'team_access_changed')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1000),
  link text not null check (char_length(link) between 1 and 500),
  source_key text not null check (char_length(source_key) between 1 and 300),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (tenant_id, recipient_user_id, source_key)
);

create index if not exists partner_notifications_recipient_idx
  on public.partner_notifications (tenant_id, partner_id, recipient_user_id, created_at desc)
  where read_at is null;

create table if not exists public.partner_notification_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  enabled_events jsonb not null default '{"partner_message":true,"lead_status_changed":true,"partner_account_changed":true,"team_access_changed":true}'::jsonb,
  do_not_disturb boolean not null default false,
  sound_muted boolean not null default true,
  sound_volume smallint not null default 70 check (sound_volume between 0 and 100),
  sound_opted_in_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, partner_id, user_id)
);

alter table public.partner_notifications enable row level security;
alter table public.partner_notification_settings enable row level security;

revoke all on public.partner_notifications, public.partner_notification_settings from public, anon, authenticated, tenant_app;
grant select, insert, update on public.partner_notifications, public.partner_notification_settings to service_role;
