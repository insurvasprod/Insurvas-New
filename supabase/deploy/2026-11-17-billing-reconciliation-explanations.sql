-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-11-17 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261117452000_billing_reconciliation_explanations.sql
-- ============================================================================

-- ─── [1/1] 20261117452000_billing_reconciliation_explanations.sql ────────────────
begin;

-- Admin › Billing › Reconciliation: "mark explained" with a note (billing-r2 screen 7, Notion §12).
--
-- The reconciliation page lists every invoice whose total disagrees with what the provider charged
-- (platform_invoices.reconciliation = 'mismatched') and every provider charge no invoice of ours accounts for
-- (a succeeded provider payment with invoice_id null). Two of its three ways to settle a row already exist —
-- raise a credit note, record a payment — and both leave their own records. The third, "this difference is
-- understood, here is why", had nowhere to live. This is that place: one row per explanation, naming the
-- invoice OR the payment it explains, the note, and the admin who wrote it.
--
-- Append-only, like audit_log: an explanation is a statement made at a moment; a later one supersedes it on
-- screen (the newest wins), and the old one stays as history. The route also writes an audit row.
--
-- A platform table, not a tenant table: no tenant_app grant and no tenant policy. RLS is on with no
-- policies, so only the service role (the admin plane's client) reads or writes it.
--
-- Additive and idempotent. Until it is applied the page still lists and settles rows by credit note or
-- payment, and its status line says "explained" needs a database update.

create table if not exists public.billing_reconciliation_explanations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.platform_invoices(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  explained_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_reconciliation_explanations_one_target check ((invoice_id is null) <> (payment_id is null))
);

create index if not exists billing_reconciliation_explanations_invoice_idx
  on public.billing_reconciliation_explanations (invoice_id, created_at desc) where invoice_id is not null;
create index if not exists billing_reconciliation_explanations_payment_idx
  on public.billing_reconciliation_explanations (payment_id, created_at desc) where payment_id is not null;
create index if not exists billing_reconciliation_explanations_explained_by_idx
  on public.billing_reconciliation_explanations (explained_by);

comment on table public.billing_reconciliation_explanations is
  'Admin notes that settle a reconciliation difference (an invoice that does not match the provider, or a provider charge with no invoice). Append-only; newest per target wins.';

alter table public.billing_reconciliation_explanations enable row level security;
revoke all on public.billing_reconciliation_explanations from anon, authenticated, public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    revoke all on public.billing_reconciliation_explanations from tenant_app;
  end if;
end $$;
-- Supabase grants service_role everything by default; append-only means no update, delete or truncate.
grant select, insert on public.billing_reconciliation_explanations to service_role;
revoke update, delete, truncate on public.billing_reconciliation_explanations from service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261117452000', 'billing_reconciliation_explanations') on conflict do nothing;
  end if;
end $bundle$;
commit;
