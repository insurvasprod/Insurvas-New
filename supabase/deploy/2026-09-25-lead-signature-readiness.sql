-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-09-25 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
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
--    1. 20260925710000_lead_signature_readiness.sql
-- ============================================================================

-- ─── [1/1] 20260925710000_lead_signature_readiness.sql ───────────────────────────
begin;

-- LeadWorkspace concept board (Design 3): "Can they finish on this call?"
--
-- Six facts the agent confirms while the customer is on the line, which decide whether an
-- application can be signed today or needs a link sent or a callback booked. Each is nullable:
-- null means "not asked yet", which is not the same as "no".
--
-- One row per lead, replaced as the answers change. It is working state for the call, not an
-- audit record; who changed it last and when are kept, and the API audits each save.
--
-- Additive and idempotent. Until it is applied the lead page says the card needs a database update.

create table if not exists public.tenant_lead_signature_readiness (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  can_receive_text boolean,
  has_phone_with_them boolean,
  can_open_email boolean,
  can_stay_on_line boolean,
  can_esign_now boolean,
  banking_to_hand boolean,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, lead_id)
);

alter table public.tenant_lead_signature_readiness enable row level security;

drop policy if exists tenant_lead_signature_readiness_tenant_scoped on public.tenant_lead_signature_readiness;
create policy tenant_lead_signature_readiness_tenant_scoped on public.tenant_lead_signature_readiness
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_signature_readiness from anon, authenticated, public;
grant select, insert, update on public.tenant_lead_signature_readiness to tenant_app;
grant select, insert, update, delete on public.tenant_lead_signature_readiness to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925710000', 'lead_signature_readiness') on conflict do nothing;
  end if;
end $bundle$;
commit;
