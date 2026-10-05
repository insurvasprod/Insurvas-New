-- LA-3 steps 6 and 23 — quotes (LA-3.5) with the term-life quote columns (LA-3.25) in place now.
--
-- docs/la3/SCHEMA-PLAN.md "Step 6" and "Step 23" are the specification. In short:
--
--   tenant_quotes        NEW  one row per quote shown; replaces deal_flow.initial_quote free text
--   tenant_applications  +FK  quote_id → tenant_quotes (the column is from step 1)
--
-- Money is bigint cents. A monthly premium at or above the face amount is rejected by CHECK (3.5);
-- an out-of-band per-$1,000 premium is only a warning, held in `warnings`. At most one selected
-- quote per attempt. Nothing deletes a quote: service_role has no DELETE.
--
-- Down (only while no row exists in tenant_quotes):
--   alter table public.tenant_applications drop constraint tenant_applications_quote_fkey;
--   drop table public.tenant_quotes;

create table if not exists public.tenant_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.tenant_application_cases(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  insured_role text not null default 'primary' check (insured_role in ('primary', 'spouse')),
  application_id uuid references public.tenant_applications(id) on delete set null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_product_id uuid references public.carrier_products(id) on delete restrict,
  product_code text not null references public.products(code) on delete restrict,
  quotation_template_id uuid references public.sales_templates(id) on delete restrict,
  template_revision integer check (template_revision is null or template_revision > 0),
  tier text check (tier is null or tier in ('level', 'graded', 'modified', 'gi')),
  face_amount_cents bigint not null check (face_amount_cents > 0),
  monthly_premium_cents bigint not null check (monthly_premium_cents > 0),
  annual_premium_cents bigint check (annual_premium_cents is null or annual_premium_cents > 0),
  age_used smallint check (age_used is null or age_used between 0 and 120),
  term_length smallint check (term_length is null or term_length between 1 and 40),
  assumed_health_class text check (assumed_health_class is null or char_length(assumed_health_class) between 1 and 60),
  rating_inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(rating_inputs) = 'object'),
  riders jsonb not null default '[]'::jsonb check (jsonb_typeof(riders) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'presented', 'selected', 'discarded')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_quotes_premium_below_face check (monthly_premium_cents < face_amount_cents)
);

-- One selected quote per attempt.
create unique index if not exists tenant_quotes_one_selected_idx
  on public.tenant_quotes (application_id) where status = 'selected';
create index if not exists tenant_quotes_case_idx on public.tenant_quotes (tenant_id, case_id, created_at desc);
create index if not exists tenant_quotes_lead_idx on public.tenant_quotes (tenant_id, lead_id);
create index if not exists tenant_quotes_application_idx on public.tenant_quotes (application_id) where application_id is not null;
create index if not exists tenant_quotes_carrier_idx on public.tenant_quotes (carrier_id);
create index if not exists tenant_quotes_carrier_product_idx on public.tenant_quotes (carrier_product_id) where carrier_product_id is not null;
create index if not exists tenant_quotes_template_idx on public.tenant_quotes (quotation_template_id) where quotation_template_id is not null;

alter table public.tenant_quotes enable row level security;
drop policy if exists tenant_quotes_tenant_scoped on public.tenant_quotes;
create policy tenant_quotes_tenant_scoped on public.tenant_quotes
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_quotes to tenant_app;
grant select, insert, update on public.tenant_quotes to service_role;
-- Default privileges in public hand service_role, anon and authenticated everything on a new table;
-- a GRANT alone does not make "nothing deletes a quote" true.
revoke delete, truncate on public.tenant_quotes from service_role, tenant_app, anon, authenticated;

drop trigger if exists tenant_quotes_touch on public.tenant_quotes;
create trigger tenant_quotes_touch before update on public.tenant_quotes
  for each row execute function public.la3_touch_updated_at();

-- The attempt's selected quote. NO ACTION (checked at statement end), not RESTRICT: a case delete
-- cascades to both the attempt and its quotes in one statement.
alter table public.tenant_applications
  drop constraint if exists tenant_applications_quote_fkey,
  add constraint tenant_applications_quote_fkey
    foreign key (quote_id) references public.tenant_quotes(id) on delete no action not valid;
alter table public.tenant_applications validate constraint tenant_applications_quote_fkey;
create index if not exists tenant_applications_quote_idx
  on public.tenant_applications (quote_id) where quote_id is not null;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_quotes_premium_below_face' and contype = 'c') then
    raise exception '20260926100400: a monthly premium at or above the face amount is not rejected';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_quotes_one_selected_idx'
                  and indexdef like '%UNIQUE%' and indexdef like '%selected%') then
    raise exception '20260926100400: more than one quote can be selected per attempt';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_quotes'
                and column_name like '%cents' and data_type <> 'bigint') then
    raise exception '20260926100400: a quote money column is not bigint cents';
  end if;
  if has_table_privilege('service_role', 'public.tenant_quotes', 'DELETE') then
    raise exception '20260926100400: quotes can be deleted';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_quote_fkey' and contype = 'f' and convalidated) then
    raise exception '20260926100400: tenant_applications.quote_id has no validated foreign key';
  end if;
end $$;
