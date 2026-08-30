-- SA-4.12 · Platform maintenance mode and announcements.
--
-- These are control-plane tables. The application reads and writes them through the service-role
-- client after resolving the current admin or tenant session. No tenant or browser role gets direct
-- table access.

create table if not exists public.maintenance (
  id              integer primary key default 1 check (id = 1),
  level           text not null check (level in ('banner_only', 'read_only', 'locked')),
  message         text not null check (length(btrim(message)) between 1 and 1000),
  scheduled_start timestamptz,
  scheduled_end   timestamptz,
  updated_by      uuid references public.admin_users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  check ((scheduled_start is null and scheduled_end is null) or
         (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start))
);

comment on table public.maintenance is
  'SA-4.12 · One platform-wide maintenance instruction. No row means maintenance is off.';
comment on column public.maintenance.scheduled_start is
  'Before this time the effective level is banner_only; between start and end the configured level applies.';

create table if not exists public.announcements (
  id             uuid primary key default gen_random_uuid(),
  message        text not null check (length(btrim(message)) between 1 and 1000),
  type           text not null check (type in ('info', 'warning', 'critical')),
  audience       text not null default 'all' check (audience in ('all', 'individual', 'agency_no_teams', 'agency_with_teams', 'management')),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null check (ends_at > starts_at),
  is_dismissible boolean not null default true,
  created_by     uuid references public.admin_users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists announcements_active_idx
  on public.announcements (starts_at, ends_at, audience);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

comment on table public.announcement_dismissals is
  'SA-4.12 · Per-user dismissal state. Dismissed announcements are not shown again to that user.';

alter table public.maintenance enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

revoke all on public.maintenance from public, anon, authenticated, tenant_app;
revoke all on public.announcements from public, anon, authenticated, tenant_app;
revoke all on public.announcement_dismissals from public, anon, authenticated, tenant_app;
