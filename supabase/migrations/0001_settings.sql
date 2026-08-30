-- SA-4.1 · Global settings store.
--
-- The first migration file in this repository. Everything before it was applied straight to the
-- live project and exists nowhere else — see docs/backlog.md #29. From here on, a schema change
-- is a file in this directory committed alongside the code that uses it.
--
-- This table is CONTROL PLANE data: it is read by the admin panel through the service-role
-- client, and no tenant may see it. RLS is enabled with no policies, which denies every role
-- that does not bypass it — `tenant_app` is NOBYPASSRLS by design (SA-0.2), so it gets nothing
-- here even though it can reach the rest of the schema.

create table if not exists public.settings (
  key         text primary key,
  value       jsonb       not null,
  type        text        not null check (type in ('number', 'boolean', 'text', 'select')),
  label       text        not null,
  "group"     text        not null,
  updated_by  uuid        references public.admin_users (id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table  public.settings is
  'SA-4.1 · Platform-wide settings. The typed registry in lib/settings/constants.ts is the source '
  'of truth for which keys exist, their types and their coded defaults; a row here only overrides '
  'a default. A key with no row is not an error.';
comment on column public.settings.value is
  'Always a JSON scalar matching `type` — number, boolean or string. Never an object.';

-- Grouped reads drive the settings screen, which lists by group then key.
create index if not exists settings_group_idx on public.settings ("group", key);

-- Control-plane only. RLS with no policy denies anon, authenticated and tenant_app outright;
-- the explicit REVOKEs mean a future policy added by accident still cannot expose it.
alter table public.settings enable row level security;

revoke all on public.settings from public;
revoke all on public.settings from anon;
revoke all on public.settings from authenticated;
revoke all on public.settings from tenant_app;

-- Seed only the keys that have a real consumer in the code today.
--
-- Deliberately NOT seeded: billing.dunning_steps_days, billing.suspend_after_days and
-- billing.cancel_after_days. SA-3.5 was cancelled because Whop runs its own dunning, and a
-- settings row nothing reads is an invitation to rebuild the ladder later just to satisfy it.
-- Also absent: billing.default_trial_days (plan_prices.trial_days already owns this per plan),
-- users.soft_delete_days (delete was descoped — backlog #14), users.session_idle_hours (no idle
-- timeout exists) and platform.maintenance_mode (SA-4.12 owns it).

insert into public.settings (key, value, type, label, "group") values
  ('users.invite_expiry_hours',
   '72'::jsonb, 'number', 'Invitation link lifetime (hours)', 'Users'),

  ('billing.refund_approval_threshold_cents',
   '50000'::jsonb, 'number', 'Refund approval threshold (cents)', 'Billing'),

  ('usage.warn_percent',
   '80'::jsonb, 'number', 'Usage warning threshold (%)', 'Usage'),

  ('platform.default_currency',
   '"USD"'::jsonb, 'select', 'Default currency', 'Platform')
on conflict (key) do nothing;
