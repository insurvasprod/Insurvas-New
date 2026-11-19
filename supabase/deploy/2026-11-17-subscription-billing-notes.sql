-- ============================================================================
-- Pending migrations — 1 file, in its own transaction
-- Written 2026-11-17 for Admin › Billing › Subscriptions (the sheet's Notes tab).
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- The file is begin … commit on its own; on an error it is rolled back and nothing is applied.
-- Re-running is safe: create-if-not-exists, and the history row uses on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261117410000_subscription_billing_notes.sql
-- ============================================================================

-- ─── [1/1] 20261117410000_subscription_billing_notes.sql ─────────────────────────
begin;

create table if not exists public.subscription_billing_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  author_id uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists subscription_billing_notes_tenant_idx
  on public.subscription_billing_notes (tenant_id, created_at desc);
create index if not exists subscription_billing_notes_subscription_idx
  on public.subscription_billing_notes (subscription_id) where subscription_id is not null;
create index if not exists subscription_billing_notes_author_idx
  on public.subscription_billing_notes (author_id) where author_id is not null;

comment on table public.subscription_billing_notes is
  'Staff notes on a customer''s billing, written from Admin › Subscriptions. Append-only; admin console (service_role) only.';

alter table public.subscription_billing_notes enable row level security;
revoke all on public.subscription_billing_notes from anon, authenticated, public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    revoke all on public.subscription_billing_notes from tenant_app;
  end if;
end $$;
grant select, insert on public.subscription_billing_notes to service_role;
revoke update, delete, truncate on public.subscription_billing_notes from service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app')
     and has_table_privilege('tenant_app', 'public.subscription_billing_notes', 'SELECT') then
    raise exception '20261117410000: tenant_app must not read billing notes';
  end if;
  if has_table_privilege('anon', 'public.subscription_billing_notes', 'SELECT') then
    raise exception '20261117410000: anon must not read billing notes';
  end if;
  if has_table_privilege('service_role', 'public.subscription_billing_notes', 'UPDATE')
     or has_table_privilege('service_role', 'public.subscription_billing_notes', 'DELETE') then
    raise exception '20261117410000: billing notes are append-only';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261117410000', 'subscription_billing_notes') on conflict do nothing;
  end if;
end $bundle$;
commit;
