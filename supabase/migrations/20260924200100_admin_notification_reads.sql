-- Staff notifications: which ones each admin has read.
--
-- The staff top bar (p-nav-admin) draws a bell. Its notifications are events the platform already
-- records — trials ending with no card (admin_trials_in_flight), plan changes, cancellations and
-- early conversions (audit_log) — so nothing about the events themselves is stored here. What did
-- not exist is "this admin has read that one", which is what makes the badge count what is
-- unhandled rather than everything that ever happened. One row per admin per source key.
--
-- A platform table, not a tenant table: no tenant_id, no tenant_app grant and no tenant policy —
-- a workspace session must never read or write staff state. RLS is on with no policies, so only
-- the service role (the admin plane's client) can touch it, exactly like partner_notifications.
--
-- Additive and idempotent. Until this is applied the bell still shows every notification, and
-- "Mark all as read" is replaced by a line saying read marks need the database update.

create table if not exists public.admin_notification_reads (
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  -- e.g. "audit:<audit_log id>" or "trial-ending:<subscription id>:<trial_ends_at>".
  source_key text not null check (char_length(source_key) between 1 and 300),
  read_at timestamptz not null default now(),
  primary key (admin_user_id, source_key)
);
create index if not exists admin_notification_reads_read_at_idx on public.admin_notification_reads (read_at);

alter table public.admin_notification_reads enable row level security;
revoke all on public.admin_notification_reads from anon, authenticated, public;
-- Explicit, in case default privileges ever grant new tables to the workspace role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    revoke all on public.admin_notification_reads from tenant_app;
  end if;
end $$;
grant select, insert, update, delete on public.admin_notification_reads to service_role;
