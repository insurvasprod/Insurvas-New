-- Admin › Billing › Subscriptions: notes on a customer's billing (billing-r2 screen 2, the sheet's Notes tab).
--
-- Staff working a past-due card, a disputed renewal or a promised discount had nowhere to write it down beside
-- the subscription; it lived in chat. One row per note: the customer (tenant) it is about, the subscription it was
-- written on (kept when that subscription later ends, so the note follows the customer), the text, the admin who
-- wrote it, and when.
--
-- Append-only, like audit_log: a note is a statement made at a moment. A correction is a new note; nothing is
-- edited or deleted. The route (POST /api/admin/subscriptions/[id]/notes) also writes an audit row.
--
-- service_role only (the admin console's server reads and writes); never tenant_app, anon or authenticated: a
-- customer must never read what staff wrote about their billing. Until this is applied the Notes tab says it
-- needs a database update (42P01 / PGRST205) and the rest of the sheet works.
--
-- Rollback: drop table if exists public.subscription_billing_notes;

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
-- Supabase grants service_role everything by default; append-only means no update, delete or truncate.
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
