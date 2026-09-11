-- SA-2.3 · Feature picker — tick features onto a plan
--
-- The join table behind the one screen that decides what an agent sees after logging in, plus the
-- three reviewed v1 plans and their exact feature sets.
--
-- Why the plan seed lives here rather than in the SA-2.2 migration: a plan's contents are what
-- make it a plan, and those contents cannot be inserted until `features` exists. SA-2.2 creates
-- the structure; this creates the three plans the business reviewed.
--
-- Source of truth for the feature sets is scripts/verify-entitlements.mjs, which pins them with
-- the comment "the verifier must fail if the catalog drifts, rather than reading the current
-- catalog back and congratulating itself for matching its own mistake". It queries
-- `plans` where version = 1 and code in ('basic','pro','advance'), so those codes and that
-- version are load-bearing. lib/features/planSeed.test.mjs keeps the two in step.
--
-- Delta from the Notion spec: SA-2.3's data block reads
-- `plan_features  plan_id, plan_version, feature_key`. The declared type in database.types.ts has
-- no `plan_version`, and it does not need one — every plan version is its own `plans` row with its
-- own id, so `plan_id` already identifies the version. Recorded in
-- docs/architecture/task-traceability.md.

-- --------------------------------------------------------------------------
-- Table
-- --------------------------------------------------------------------------

create table if not exists public.plan_features (
  plan_id     uuid not null,
  feature_key text not null,
  created_at  timestamptz not null default now(),
  constraint plan_features_pkey primary key (plan_id, feature_key)
);

comment on table public.plan_features is
  'SA-2.3 · Which features one plan VERSION grants. Editing a live plan creates a new plans row '
  'and a new set of these, so an existing subscriber keeps the features they bought.';

do $$ begin
  alter table public.plan_features
    add constraint plan_features_plan_id_fkey foreign key (plan_id)
    references public.plans (id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- Referencing feature_key rather than features.id is deliberate: the key is the immutable
-- contract with requireFeature() guards, and SA-2.1 forbids renaming one. The foreign key is what
-- stops a plan granting a feature that was never in the catalog.
do $$ begin
  alter table public.plan_features
    add constraint plan_features_feature_key_fkey foreign key (feature_key)
    references public.features (feature_key) on update cascade;
exception when duplicate_object then null;
end $$;

create index if not exists plan_features_feature_idx on public.plan_features (feature_key);

alter table public.plan_features enable row level security;

drop policy if exists plan_features_service_role_only on public.plan_features;
create policy plan_features_service_role_only on public.plan_features
  for all to service_role using (true) with check (true);

revoke all on public.plan_features from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.plan_features to service_role;

-- --------------------------------------------------------------------------
-- The three reviewed v1 individual plans
--
-- SA-2.2: "Three `individual` plans, seeded". Names and ordering are placeholders the business
-- edits in the admin screen — only `code`, `version` and `plan_type` are load-bearing, because
-- that is what the entitlement verifier and the agent app resolve against.
-- --------------------------------------------------------------------------

insert into public.plans (code, version, name, plan_type, description, is_public, is_default, sort_order) values
  ('basic',   1, 'Basic',   'individual', 'Book of business and commissions.',              true, true,  1),
  ('pro',     1, 'Pro',     'individual', 'Adds acquisition, selling and compliance.',      true, false, 2),
  ('advance', 1, 'Advance', 'individual', 'Everything, including retention and insight.',   true, false, 3)
on conflict (code, version) do nothing;

-- --------------------------------------------------------------------------
-- Feature sets — must stay identical to EXPECTED_FEATURES in verify-entitlements.mjs
-- --------------------------------------------------------------------------

insert into public.plan_features (plan_id, feature_key)
select p.id, seed.feature_key
  from public.plans p
  join (values
    -- basic (5)
    ('basic',   'appointment_vault'),
    ('basic',   'book_of_business'),
    ('basic',   'commission_ledger'),
    ('basic',   'discrepancy_report'),
    ('basic',   'statement_ingestion'),

    -- pro (16) — basic plus acquisition, selling and the compliance basics
    ('pro',     'applications'),
    ('pro',     'appointment_vault'),
    ('pro',     'book_of_business'),
    ('pro',     'callback_calendar'),
    ('pro',     'commission_ledger'),
    ('pro',     'consent_locker'),
    ('pro',     'daily_deal_flow'),
    ('pro',     'discrepancy_report'),
    ('pro',     'draft_date_optimizer'),
    ('pro',     'duplicate_detection'),
    ('pro',     'inbound_transfers'),
    ('pro',     'lead_import'),
    ('pro',     'outbound_dialing'),
    ('pro',     'quoting'),
    ('pro',     'statement_ingestion'),
    ('pro',     'tcpa_checker'),

    -- advance (26) — pro plus retention, insight, partners and accounting
    ('advance', 'applications'),
    ('advance', 'appointment_vault'),
    ('advance', 'book_of_business'),
    ('advance', 'callback_calendar'),
    ('advance', 'chargeback_radar'),
    ('advance', 'cohort_persistency'),
    ('advance', 'commission_ledger'),
    ('advance', 'consent_locker'),
    ('advance', 'daily_deal_flow'),
    ('advance', 'discrepancy_report'),
    ('advance', 'draft_date_optimizer'),
    ('advance', 'duplicate_detection'),
    ('advance', 'inbound_transfers'),
    ('advance', 'lead_import'),
    ('advance', 'litigation_packet'),
    ('advance', 'outbound_dialing'),
    ('advance', 'payment_repair'),
    ('advance', 'payout_runs'),
    ('advance', 'profit_and_loss'),
    ('advance', 'publisher_records'),
    ('advance', 'quoting'),
    ('advance', 'statement_ingestion'),
    ('advance', 'tax_summaries'),
    ('advance', 'tcpa_checker'),
    ('advance', 'true_cpa'),
    ('advance', 'winback')
  ) as seed(plan_code, feature_key) on seed.plan_code = p.code
 where p.version = 1
on conflict do nothing;

-- `partner_portal` and `partner_quality` are in the catalog and deliberately in none of these
-- three plans. They are not unsold by accident: leaving them out is what the reviewed v1
-- entitlements say.
