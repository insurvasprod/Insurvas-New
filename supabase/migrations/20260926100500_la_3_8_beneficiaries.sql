-- LA-3 step 7 — beneficiaries (LA-3.8).
--
-- docs/la3/SCHEMA-PLAN.md "Step 7" is the specification. In short:
--
--   tenant_application_beneficiaries  NEW  one row per beneficiary per attempt
--
-- Shares are integer hundredths of a percent (`share_bp`: 3334 is 33.34%), so a tier's total is an
-- exact integer sum and 33.34 + 33.33 + 33.33 is exactly 10 000. The 100.00 totals are checked by
-- the QA engine and the `ready` guard (lib/applications/beneficiaries.ts), not by a row CHECK — a
-- total is not a property of one row. An estate, trust or funeral home is named in last_name.
--
-- Down (only while no row exists): drop table public.tenant_application_beneficiaries;

create table if not exists public.tenant_application_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tier text not null check (tier in ('primary', 'contingent')),
  first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 160),
  relationship text not null
    check (relationship in ('spouse', 'child', 'parent', 'sibling', 'grandchild', 'estate', 'trust', 'funeral_home', 'other')),
  relationship_other text check (relationship_other is null or char_length(btrim(relationship_other)) between 1 and 80),
  dob date,
  share_bp integer not null check (share_bp > 0 and share_bp <= 10000),
  phone text check (phone is null or char_length(phone) <= 32),
  address jsonb check (address is null or jsonb_typeof(address) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint tenant_application_beneficiaries_other_named check (relationship <> 'other' or relationship_other is not null),
  -- A person has a first name; an estate, trust or funeral home does not need one.
  constraint tenant_application_beneficiaries_person_named
    check (relationship in ('estate', 'trust', 'funeral_home') or first_name is not null)
);
create index if not exists tenant_application_beneficiaries_app_idx
  on public.tenant_application_beneficiaries (application_id, tier, sort_order);
create index if not exists tenant_application_beneficiaries_tenant_idx
  on public.tenant_application_beneficiaries (tenant_id);

alter table public.tenant_application_beneficiaries enable row level security;
drop policy if exists tenant_application_beneficiaries_tenant_scoped on public.tenant_application_beneficiaries;
create policy tenant_application_beneficiaries_tenant_scoped on public.tenant_application_beneficiaries
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_beneficiaries to tenant_app;
grant select, insert, update, delete on public.tenant_application_beneficiaries to service_role;

drop trigger if exists tenant_application_beneficiaries_touch on public.tenant_application_beneficiaries;
create trigger tenant_application_beneficiaries_touch before update on public.tenant_application_beneficiaries
  for each row execute function public.la3_touch_updated_at();

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_application_beneficiaries' and column_name = 'share_bp') is distinct from 'integer' then
    raise exception '20260926100500: beneficiary shares are not integer hundredths of a percent';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_application_beneficiaries'
                and data_type in ('real', 'double precision', 'numeric')) then
    raise exception '20260926100500: a beneficiary column is fractional';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_beneficiaries_other_named' and contype = 'c') then
    raise exception '20260926100500: an "other" relationship can be left unnamed';
  end if;
end $$;
