-- Partner portal compatibility: the current service exposes invited_at while the legacy table
-- only retained created_at.
alter table public.partner_users
  add column if not exists invited_at timestamptz not null default now();

update public.partner_users
   set invited_at = coalesce(invited_at, created_at, now())
 where invited_at is null;
