-- SA-2.1 · Feature catalog
--
-- The master list of everything a subscription can switch on, grouped into modules. It is what
-- the plan editor ticks against (SA-2.3), what the kill-switch screen lists (SA-4.10), and what
-- the entitlement object is assembled from (SA-2.8).
--
-- Why this migration exists: `public.features` and `public.feature_modules` are declared in
-- lib/supabase/database.types.ts and read by lib/features/queries.ts, but no committed migration
-- ever created them. `/api/admin/features` currently returns 200 with an empty catalog, so a
-- missing table reads as an empty one — see docs/architecture/task-traceability.md.
--
-- Column set, constraint names and the module foreign key are taken from the declared types and
-- from the error codes app/api/admin/features/route.ts already handles: 23505 for a duplicate
-- feature_key, 23503 for a module that does not exist.

-- --------------------------------------------------------------------------
-- Tables
-- --------------------------------------------------------------------------

create table if not exists public.feature_modules (
  key         text primary key,
  label       text not null,
  sort_order  integer not null,
  created_at  timestamptz not null default now()
);

comment on table public.feature_modules is
  'SA-2.1 · The grouping an agent sees as a menu section. Seeded; rarely changed.';

create table if not exists public.features (
  id           uuid primary key default gen_random_uuid(),
  feature_key  text not null,
  label        text not null,
  module       text not null,
  description  text,
  sort_order   integer not null default 0,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.features is
  'SA-2.1 · Every feature a plan can grant. feature_key is the contract with requireFeature() '
  'guards and menu nodes, so it is immutable once created — archive instead of renaming.';

comment on column public.features.is_archived is
  'Archived features stay enforced for existing subscribers and disappear from the plan picker. '
  'Never delete a feature a plan has ever referenced.';

-- feature_key is referenced by requireFeature() guards, menu nodes and every plan built on it.
-- The uniqueness is what produces the 23505 the create-feature route reports as a friendly error.
do $$ begin
  alter table public.features add constraint features_feature_key_key unique (feature_key);
exception when duplicate_table or duplicate_object then null;
end $$;

-- Named to match the declared relationship in database.types.ts (features_module_fkey), and the
-- 23503 the route reports as "That module doesn't exist".
do $$ begin
  alter table public.features
    add constraint features_module_fkey foreign key (module)
    references public.feature_modules (key) on update cascade;
exception when duplicate_object then null;
end $$;

-- Mirrors FEATURE_KEY_PATTERN in lib/features/constants.ts. A key that does not match would
-- become an unreachable guard name, so the database refuses it rather than the form alone.
do $$ begin
  alter table public.features
    add constraint features_feature_key_format check (feature_key ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null;
end $$;

create index if not exists features_module_sort_idx on public.features (module, sort_order);
create index if not exists features_active_idx on public.features (sort_order) where not is_archived;

-- --------------------------------------------------------------------------
-- Access. Read through the server-side service client only; no client role touches this.
-- --------------------------------------------------------------------------

alter table public.feature_modules enable row level security;
alter table public.features enable row level security;

drop policy if exists feature_modules_service_role_only on public.feature_modules;
create policy feature_modules_service_role_only on public.feature_modules
  for all to service_role using (true) with check (true);

drop policy if exists features_service_role_only on public.features;
create policy features_service_role_only on public.features
  for all to service_role using (true) with check (true);

revoke all on public.feature_modules from public, anon, authenticated, tenant_app;
revoke all on public.features from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.feature_modules to service_role;
grant select, insert, update, delete on public.features to service_role;

-- --------------------------------------------------------------------------
-- Seed — the Individual Agent product
--
-- Idempotent: re-running never duplicates a row and never overwrites a label an admin has since
-- edited. `on conflict do nothing` is deliberate — this seed establishes the catalog, it does not
-- own it afterwards. Adding a feature later is an admin action, not a deploy (SA-2.1 criterion 1).
-- --------------------------------------------------------------------------

insert into public.feature_modules (key, label, sort_order) values
  ('book',        'Book of business', 1),
  ('acquisition', 'Acquisition',      2),
  ('sell',        'Sell',             3),
  ('retention',   'Retention',        4),
  ('insight',     'Insight',          5),
  ('partners',    'Partners',         6),
  ('accounting',  'Accounting',       7),
  ('compliance',  'Compliance',       8),
  -- Seeded with no features under it, exactly as SA-2.1 says: the agency product is out of scope
  -- but the module must be visible so it is obvious nothing has been built there yet.
  ('agency',      'Agency',           9)
on conflict (key) do nothing;

insert into public.features (feature_key, label, module, sort_order) values
  ('book_of_business',     'Policies & book of business',        'book',        1),
  ('statement_ingestion',  'Carrier statement import',           'book',        2),
  ('commission_ledger',    'Commission ledger',                  'book',        3),
  ('appointment_vault',    'Appointments & contract levels',     'book',        4),
  ('discrepancy_report',   'Discrepancy report',                 'book',        5),

  ('inbound_transfers',    'Inbound live transfers',             'acquisition', 1),
  ('outbound_dialing',     'Outbound dialer',                    'acquisition', 2),
  ('lead_import',          'Purchased list import',              'acquisition', 3),
  ('duplicate_detection',  'Duplicate & existing-customer check','acquisition', 4),

  ('quoting',              'Quoting',                            'sell',        1),
  ('applications',         'Dynamic application forms',          'sell',        2),
  ('draft_date_optimizer', 'Draft-date optimiser',               'sell',        3),
  ('callback_calendar',    'Callback calendar',                  'sell',        4),
  ('daily_deal_flow',      'Daily deal flow',                    'sell',        5),

  ('chargeback_radar',     'Predictive lapse scoring',           'retention',   1),
  ('payment_repair',       'Failed-payment repair',              'retention',   2),
  ('winback',              'Win-back campaigns',                 'retention',   3),

  ('true_cpa',             'True cost per acquisition',          'insight',     1),
  ('cohort_persistency',   'Persistency by lead source',         'insight',     2),
  -- Not in the SA-2.1 seed table, which predates LA-1.18. It is guarded by requireFeature() in
  -- app/api/app/partner-quality/*, so leaving it out would make check:features report an unknown
  -- guard. Recorded as a deliberate delta in docs/architecture/task-traceability.md.
  ('partner_quality',      'Partner quality',                    'insight',     3),

  ('publisher_records',    'Publisher management',               'partners',    1),
  ('payout_runs',          'Payout runs',                        'partners',    2),
  ('partner_portal',       'External publisher logins',          'partners',    3),

  ('profit_and_loss',      'Full P&L',                           'accounting',  1),
  ('tax_summaries',        'Tax summaries & 1099',               'accounting',  2),

  ('tcpa_checker',         'TCPA / DNC checker',                 'compliance',  1),
  ('consent_locker',       'Consent certificate storage',        'compliance',  2),
  ('litigation_packet',    'Litigation packet export',           'compliance',  3)
on conflict (feature_key) do nothing;
