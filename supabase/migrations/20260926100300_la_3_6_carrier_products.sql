-- LA-3 steps 4, 5 and 23 — appointments detail (LA-3.6), carrier products (LA-3.4) and the term-life
-- product columns (LA-3.25), in one file so no step re-migrates carrier_products.
--
-- docs/la3/SCHEMA-PLAN.md "Step 4", "Step 5" and "Step 23" are the specification. In short:
--
--   tenant_carriers     +2 columns  upline_name, notes (everything else in 3.6 already exists)
--   carriers            +3 columns  portal_origin (https origin), reference_pattern, billing_descriptor
--   carrier_products    NEW         platform rows (tenant_id null) plus tenant rows; FE and term limits
--   tenant_applications +FK         carrier_product_id → carrier_products (the column is from step 1)
--
-- The payout strip is computed from commission_schedules / advance_rules (Q7) — no table here.
-- premium_per_1000_band_* are numeric(6,2) dollars per $1,000 of face: a plausibility band, not money.
--
-- Down (only while no row exists in carrier_products):
--   alter table public.tenant_applications drop constraint tenant_applications_carrier_product_fkey;
--   drop table public.carrier_products;
--   alter table public.carriers drop column portal_origin, drop column reference_pattern, drop column billing_descriptor;
--   alter table public.tenant_carriers drop column upline_name, drop column notes;

-- ── 1 · appointments detail (3.6) ───────────────────────────────────────────
alter table public.tenant_carriers
  add column if not exists upline_name text check (upline_name is null or char_length(upline_name) <= 160),
  add column if not exists notes text check (notes is null or char_length(notes) <= 2000);

-- ── 2 · carrier portal facts (3.12, 3.15, 3.20) ─────────────────────────────
alter table public.carriers
  add column if not exists portal_origin text
    constraint carriers_portal_origin_https check (portal_origin is null or portal_origin ~ '^https://[^/]+$'),
  add column if not exists reference_pattern text
    constraint carriers_reference_pattern_length check (reference_pattern is null or char_length(reference_pattern) between 1 and 200),
  add column if not exists billing_descriptor text
    constraint carriers_billing_descriptor_length check (billing_descriptor is null or char_length(billing_descriptor) between 1 and 60);

-- ── 3 · carrier products ────────────────────────────────────────────────────
create table if not exists public.carrier_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  product_code text not null references public.products(code) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  tiers text[] not null default '{}'::text[]
    check (tiers <@ array['level', 'graded', 'modified', 'gi']::text[]),
  issue_age_min smallint check (issue_age_min is null or issue_age_min between 0 and 120),
  issue_age_max smallint check (issue_age_max is null or issue_age_max between 0 and 120),
  face_min_cents bigint check (face_min_cents is null or face_min_cents >= 0),
  face_max_cents bigint check (face_max_cents is null or face_max_cents >= 0),
  premium_per_1000_band_min numeric(6,2) check (premium_per_1000_band_min is null or premium_per_1000_band_min >= 0),
  premium_per_1000_band_max numeric(6,2) check (premium_per_1000_band_max is null or premium_per_1000_band_max >= 0),
  accepted_payment_methods text[] not null default '{}'::text[]
    check (accepted_payment_methods <@ array['ach', 'direct_express', 'debit_card', 'credit_card', 'direct_bill']::text[]),
  is_active boolean not null default true,
  -- Term life (Step 23). Null on final expense products.
  term_lengths smallint[] check (term_lengths is null or (cardinality(term_lengths) > 0 and 1 <= all (term_lengths) and 40 >= all (term_lengths))),
  health_classes text[] check (health_classes is null or cardinality(health_classes) > 0),
  face_bands jsonb check (face_bands is null or jsonb_typeof(face_bands) = 'array'),
  exam_required_above_face_cents bigint check (exam_required_above_face_cents is null or exam_required_above_face_cents >= 0),
  convertible boolean,
  conversion_deadline_rule text check (conversion_deadline_rule is null or char_length(conversion_deadline_rule) <= 200),
  renewal_type text check (renewal_type is null or renewal_type in ('annual_renewable', 'level')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_products_age_range check (issue_age_min is null or issue_age_max is null or issue_age_min <= issue_age_max),
  constraint carrier_products_face_range check (face_min_cents is null or face_max_cents is null or face_min_cents <= face_max_cents),
  constraint carrier_products_band_range check (premium_per_1000_band_min is null or premium_per_1000_band_max is null
                                                or premium_per_1000_band_min <= premium_per_1000_band_max)
);

create unique index if not exists carrier_products_name_unique
  on public.carrier_products (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    carrier_id,
    product_code,
    name
  );
create index if not exists carrier_products_carrier_idx on public.carrier_products (carrier_id, product_code);
create index if not exists carrier_products_tenant_idx on public.carrier_products (tenant_id) where tenant_id is not null;
create index if not exists carrier_products_product_idx on public.carrier_products (product_code);

alter table public.carrier_products enable row level security;
drop policy if exists carrier_products_tenant_read on public.carrier_products;
create policy carrier_products_tenant_read on public.carrier_products
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_products_tenant_scoped on public.carrier_products;
create policy carrier_products_tenant_scoped on public.carrier_products
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_products to tenant_app;
grant select, insert, update, delete on public.carrier_products to service_role;

drop trigger if exists carrier_products_touch on public.carrier_products;
create trigger carrier_products_touch before update on public.carrier_products
  for each row execute function public.la3_touch_updated_at();

-- ── 4 · the attempt's carrier product (column from step 1) ──────────────────
alter table public.tenant_applications
  drop constraint if exists tenant_applications_carrier_product_fkey,
  add constraint tenant_applications_carrier_product_fkey
    foreign key (carrier_product_id) references public.carrier_products(id) on delete restrict not valid;
alter table public.tenant_applications validate constraint tenant_applications_carrier_product_fkey;
create index if not exists tenant_applications_carrier_product_idx
  on public.tenant_applications (carrier_product_id) where carrier_product_id is not null;

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'carrier_products'
         and column_name in ('term_lengths', 'health_classes', 'face_bands', 'exam_required_above_face_cents',
                             'convertible', 'conversion_deadline_rule', 'renewal_type')) <> 7 then
    raise exception '20260926100300: carrier_products lacks a term-life column';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'carrier_products'
                and column_name like '%cents' and data_type <> 'bigint') then
    raise exception '20260926100300: a carrier_products money column is not bigint cents';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'carrier_products_name_unique') then
    raise exception '20260926100300: one carrier product per (tenant, carrier, product, name) is not enforced';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_carrier_product_fkey' and contype = 'f' and convalidated) then
    raise exception '20260926100300: tenant_applications.carrier_product_id has no validated foreign key';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_carriers' and column_name in ('upline_name', 'notes')) <> 2 then
    raise exception '20260926100300: tenant_carriers lacks upline_name or notes';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'carriers'
         and column_name in ('portal_origin', 'reference_pattern', 'billing_descriptor')) <> 3 then
    raise exception '20260926100300: carriers lacks a portal column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carriers_portal_origin_https' and contype = 'c') then
    raise exception '20260926100300: the carrier portal origin is not constrained to an https origin';
  end if;
end $$;
