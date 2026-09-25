-- Shared shell compatibility for the existing organization-oriented project.
-- These columns let the tenant plane read the callback and announcement contracts
-- without changing or deleting the existing organization records.

alter table public.callbacks add column if not exists tenant_id uuid;
update public.callbacks
set tenant_id = organization_id
where tenant_id is null;
create index if not exists callbacks_tenant_due_idx
  on public.callbacks (tenant_id, scheduled_at_utc);

create table if not exists public.callback_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  callback_id uuid not null references public.callbacks(id) on delete cascade,
  lead_id uuid not null,
  actor_user_id uuid,
  action text not null,
  old_scheduled_at_utc timestamptz,
  new_scheduled_at_utc timestamptz,
  old_status text,
  new_status text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists callback_history_tenant_idx
  on public.callback_history (tenant_id, callback_id, created_at);

alter table public.announcements add column if not exists message text;
update public.announcements
set message = coalesce(nullif(btrim(message), ''), nullif(btrim(description), ''), title)
where message is null or btrim(message) = '';
alter table public.announcements alter column message set default '';
alter table public.announcements alter column message set not null;
alter table public.announcements add column if not exists type text not null default 'info';
alter table public.announcements add column if not exists audience text not null default 'all';
alter table public.announcements add column if not exists starts_at timestamptz not null default now();
alter table public.announcements add column if not exists ends_at timestamptz not null default '9999-12-31 23:59:59+00';
alter table public.announcements add column if not exists is_dismissible boolean not null default true;

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.callback_history enable row level security;
alter table public.announcement_dismissals enable row level security;

revoke all on public.callback_history from public, anon, authenticated, tenant_app;
revoke all on public.announcement_dismissals from public, anon, authenticated, tenant_app;
grant all on public.callback_history to service_role;
grant all on public.announcement_dismissals to service_role;
