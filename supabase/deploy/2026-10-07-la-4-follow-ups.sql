-- ============================================================================
-- Pending migrations — 3 files, each in its own transaction
-- Generated 2026-10-06 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
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
--    1. 20261007100000_la_4_persistency_on_ledger.sql
--    2. 20261007110000_la_4_carrier_commission_contacts.sql
--    3. 20261007120000_la_4_drop_v1_statement_import.sql
-- ============================================================================

-- ─── [1/3] 20261007100000_la_4_persistency_on_ledger.sql ─────────────────────────
begin;

-- LA-4 follow-up · persistency on every plan, from Ledger up (owner decision 2026-10-06, backlog #210).
--
-- `cohort_persistency` was granted to `advance` only. The roadmap calls persistency the core idea for
-- every agent ("one early lapse wipes out roughly 26 good sales"), so it now ships with the Ledger
-- plan. The plans stay nested (lib/features/planSeed.test.mjs: no feature is lost on an upgrade), so
-- it is granted to every plan that holds `statement_ingestion`, which is basic, pro and advance today,
-- and any plan built on them.
--
-- Plan data only: the page, the API and the menu already gate on the feature. Every tenant subscribed
-- to one of those plans gets its entitlement refreshed here, so the menu item appears without waiting
-- for the next subscription event. A refresh that fails is a warning, never a failed grant.
--
-- Rollback:
--   delete from public.plan_features pf using public.plans p
--    where pf.plan_id = p.id and pf.feature_key = 'cohort_persistency' and p.code in ('basic', 'pro');
--   then refresh those tenants' entitlements.

-- Granted to exactly the plans that hold statement_ingestion, whatever those are live.
insert into public.plan_features (plan_id, feature_key)
select pf.plan_id, f.key
  from public.plan_features pf
  cross join (values ('cohort_persistency')) as f(key)
 where pf.feature_key = 'statement_ingestion'
on conflict do nothing;

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select distinct s.tenant_id
      from public.subscriptions s
      join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = 'cohort_persistency'
  loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'LA-4 persistency grant: could not refresh the entitlement of tenant %: %', v_tenant, sqlerrm;
    end;
  end loop;
end;
$$;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.plans p
     where p.code in ('basic', 'pro', 'advance')
       and not exists (select 1 from public.plan_features pf where pf.plan_id = p.id and pf.feature_key = 'cohort_persistency')
  ) then
    raise exception '20261007100000: a reviewed plan (basic, pro, advance) does not grant cohort_persistency';
  end if;
  if exists (
    select 1 from public.plan_features pf
     where pf.feature_key = 'statement_ingestion'
       and not exists (select 1 from public.plan_features q where q.plan_id = pf.plan_id and q.feature_key = 'cohort_persistency')
  ) then
    raise exception '20261007100000: a plan with statement_ingestion lacks cohort_persistency';
  end if;
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261007100000', 'la_4_persistency_on_ledger') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/3] 20261007110000_la_4_carrier_commission_contacts.sql ───────────────────
begin;

-- LA-4.5 follow-up · where a dispute letter goes: each carrier's commissions department, per agency.
--
-- The carrier library (public.carriers) is platform data with no contact details, so the letter's
-- "To" block was typed by hand and remembered only in that person's browser. An agency now keeps one
-- commissions address (and an optional email) per carrier, shared by everyone who prints letters.
-- It is set from the letter itself ("Save as this carrier's address") by an owner or bookkeeper.
--
-- Additive. Requires 20260831110000 (carriers) and the tenants and users tables.
--
-- Rollback: drop table if exists public.tenant_carrier_commission_contacts;

create table if not exists public.tenant_carrier_commission_contacts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  address text not null,
  email text,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint tenant_carrier_commission_contacts_pkey primary key (tenant_id, carrier_id),
  constraint tenant_carrier_commission_contacts_address check (char_length(btrim(address)) between 1 and 600),
  constraint tenant_carrier_commission_contacts_email check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
);

create index if not exists tenant_carrier_commission_contacts_carrier_idx
  on public.tenant_carrier_commission_contacts (carrier_id);
create index if not exists tenant_carrier_commission_contacts_updated_by_idx
  on public.tenant_carrier_commission_contacts (updated_by);

alter table public.tenant_carrier_commission_contacts enable row level security;
drop policy if exists tenant_carrier_commission_contacts_tenant_read on public.tenant_carrier_commission_contacts;
create policy tenant_carrier_commission_contacts_tenant_read on public.tenant_carrier_commission_contacts
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_carrier_commission_contacts from public, anon, authenticated;
revoke delete, truncate on public.tenant_carrier_commission_contacts from service_role, tenant_app;
grant select, insert, update on public.tenant_carrier_commission_contacts to service_role;
grant select on public.tenant_carrier_commission_contacts to tenant_app;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenant_carrier_commission_contacts') then
    raise exception '20261007110000: tenant_carrier_commission_contacts is missing';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tenant_carrier_commission_contacts' and policyname = 'tenant_carrier_commission_contacts_tenant_read') then
    raise exception '20261007110000: the tenant read policy is missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_carrier_commission_contacts', 'DELETE') then
    raise exception '20261007110000: commission contacts can be deleted';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261007110000', 'la_4_carrier_commission_contacts') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/3] 20261007120000_la_4_drop_v1_statement_import.sql ──────────────────────
begin;

-- LA-4 follow-up · drop the LA-0 statement import, now that every import goes through v2.
--
-- import_commission_statement (20260924260100) was kept as the fallback while migration
-- 20261002100000 (LA-4.1–4.3: stored originals, PDFs, name matching, re-processing) was not yet
-- applied. That migration has been live since 2026-10-02 and the app no longer calls the v1
-- function (lib/ledger/statementService.ts importStatementFile), so it is removed: one import path,
-- the one that keeps the original file.
--
-- Nothing else uses it: decide_commission_statement_lines, the void path and the views do not
-- call it. Every statement it ever wrote stays exactly as it is.
--
-- Rollback: re-run the import_commission_statement block and its grants from 20260924260100.

drop function if exists public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'import_commission_statement') then
    raise exception '20261007120000: import_commission_statement is still there';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'import_commission_statement_v2') then
    raise exception '20261007120000: import_commission_statement_v2 is missing; do not drop v1 without it';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261007120000', 'la_4_drop_v1_statement_import') on conflict do nothing;
  end if;
end $bundle$;
commit;
