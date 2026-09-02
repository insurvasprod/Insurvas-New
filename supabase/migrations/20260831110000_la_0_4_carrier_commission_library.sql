-- LA-0.4 carrier, product and commission schedule library.
--
-- Platform carriers are reference data maintained by the admin plane. Tenant carrier rows and
-- financial schedules are tenant-scoped snapshots. A new effective_from value is a new record;
-- callers never rewrite an older dated row when a contract level changes.

create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 160),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_carriers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  contract_level_bp integer not null check (contract_level_bp between 0 and 100000),
  writing_number text not null check (length(trim(writing_number)) between 1 and 120),
  effective_from date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tenant_carriers_effective_key unique (tenant_id, carrier_id, effective_from)
);

create table if not exists public.commission_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  product_code text not null references public.products(code) on update cascade on delete restrict,
  contract_level_bp integer not null check (contract_level_bp between 0 and 100000),
  policy_year integer not null check (policy_year between 1 and 100),
  rate_bp integer not null check (rate_bp between 0 and 100000),
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint commission_schedules_effective_key unique
    (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, effective_from)
);

create table if not exists public.advance_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  product_code text not null references public.products(code) on update cascade on delete restrict,
  advance_months integer not null check (advance_months between 0 and 120),
  advance_pct_bp integer not null check (advance_pct_bp between 0 and 100000),
  clawback_months integer not null check (clawback_months between 0 and 240),
  clawback_type text not null check (clawback_type in ('full', 'prorated')),
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint advance_rules_effective_key unique
    (tenant_id, carrier_id, product_code, effective_from)
);

create index if not exists carriers_active_order_idx on public.carriers (is_active, sort_order, name);
create index if not exists tenant_carriers_lookup_idx on public.tenant_carriers (tenant_id, carrier_id, effective_from desc);
create index if not exists commission_schedules_lookup_idx
  on public.commission_schedules (tenant_id, carrier_id, product_code, policy_year, effective_from desc);
create index if not exists advance_rules_lookup_idx
  on public.advance_rules (tenant_id, carrier_id, product_code, effective_from desc);

-- Keep reference data available on projects where the SA-4.5 migration created the table before
-- its seed was deployed. Both inserts are idempotent and remain editable through the admin APIs.
insert into public.products (code, name, category, sort_order) values
  ('final_expense', 'Final Expense', 'life', 10),
  ('term_life', 'Term Life', 'life', 20),
  ('whole_life', 'Whole Life', 'life', 30),
  ('iul', 'Indexed Universal Life', 'life', 40),
  ('medicare_advantage', 'Medicare Advantage', 'health', 50),
  ('annuity', 'Annuity', 'retirement', 60)
on conflict (code) do nothing;

insert into public.carriers (code, name, sort_order) values
  ('mutual_of_omaha', 'Mutual of Omaha', 10),
  ('aetna', 'Aetna / CVS', 20),
  ('americo', 'Americo', 30),
  ('foresters', 'Foresters', 40),
  ('gerber', 'Gerber Life', 50),
  ('transamerica', 'Transamerica', 60),
  ('national_life', 'National Life Group', 70),
  ('american_national', 'American National', 80)
on conflict (code) do nothing;

alter table public.carriers enable row level security;
alter table public.tenant_carriers enable row level security;
alter table public.commission_schedules enable row level security;
alter table public.advance_rules enable row level security;

revoke all on table public.carriers, public.tenant_carriers, public.commission_schedules, public.advance_rules from anon, authenticated;
grant select, insert, update on table public.carriers to service_role;
grant select, insert, update on table public.tenant_carriers, public.commission_schedules, public.advance_rules to service_role;

create or replace function public.touch_carrier_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists carriers_touch_updated_at on public.carriers;
create trigger carriers_touch_updated_at before update on public.carriers for each row execute function public.touch_carrier_updated_at();
revoke all on function public.touch_carrier_updated_at() from public;

-- The service-role API performs authorization before calling these functions. Keeping the
-- effective-dated upserts in Postgres makes two simultaneous saves deterministic and preserves the
-- old rows that historical commission calculations need.
create or replace function public.save_tenant_carrier(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_contract_level_bp integer,
  p_writing_number text,
  p_effective_from date
)
returns public.tenant_carriers
language plpgsql
security invoker
as $$
declare
  v_row public.tenant_carriers;
begin
  if not exists (select 1 from public.carriers where id = p_carrier_id and is_active) then
    raise exception 'Carrier is not available';
  end if;

  update public.tenant_carriers
     set is_active = false
   where tenant_id = p_tenant_id
     and carrier_id = p_carrier_id
     and is_active;

  insert into public.tenant_carriers (tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active)
  values (p_tenant_id, p_carrier_id, p_contract_level_bp, trim(p_writing_number), p_effective_from, true)
  on conflict (tenant_id, carrier_id, effective_from) do update
    set contract_level_bp = excluded.contract_level_bp,
        writing_number = excluded.writing_number,
        is_active = true
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.save_commission_schedule(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_product_code text,
  p_contract_level_bp integer,
  p_policy_year integer,
  p_rate_bp integer,
  p_effective_from date
)
returns public.commission_schedules
language plpgsql
security invoker
as $$
declare
  v_row public.commission_schedules;
begin
  if not exists (
    select 1 from public.tenant_carriers tc
    where tc.tenant_id = p_tenant_id and tc.carrier_id = p_carrier_id
      and tc.contract_level_bp = p_contract_level_bp
      and tc.effective_from <= p_effective_from
  ) then
    raise exception 'Save the carrier contract level before its commission schedule';
  end if;

  insert into public.commission_schedules
    (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from)
  values
    (p_tenant_id, p_carrier_id, p_product_code, p_contract_level_bp, p_policy_year, p_rate_bp, p_effective_from)
  on conflict (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, effective_from) do update
    set rate_bp = excluded.rate_bp
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.save_advance_rule(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_product_code text,
  p_advance_months integer,
  p_advance_pct_bp integer,
  p_clawback_months integer,
  p_clawback_type text,
  p_effective_from date
)
returns public.advance_rules
language plpgsql
security invoker
as $$
declare
  v_row public.advance_rules;
begin
  if not exists (
    select 1 from public.tenant_carriers tc
    where tc.tenant_id = p_tenant_id and tc.carrier_id = p_carrier_id and tc.is_active
      and tc.effective_from <= p_effective_from
  ) then
    raise exception 'Save the carrier contract level before its advance rule';
  end if;

  insert into public.advance_rules
    (tenant_id, carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from)
  values
    (p_tenant_id, p_carrier_id, p_product_code, p_advance_months, p_advance_pct_bp, p_clawback_months, p_clawback_type, p_effective_from)
  on conflict (tenant_id, carrier_id, product_code, effective_from) do update
    set advance_months = excluded.advance_months,
        advance_pct_bp = excluded.advance_pct_bp,
        clawback_months = excluded.clawback_months,
        clawback_type = excluded.clawback_type
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_tenant_carrier(uuid, uuid, integer, text, date) from public, anon, authenticated;
revoke all on function public.save_commission_schedule(uuid, uuid, text, integer, integer, integer, date) from public, anon, authenticated;
revoke all on function public.save_advance_rule(uuid, uuid, text, integer, integer, integer, text, date) from public, anon, authenticated;
grant execute on function public.save_tenant_carrier(uuid, uuid, integer, text, date) to service_role;
grant execute on function public.save_commission_schedule(uuid, uuid, text, integer, integer, integer, date) to service_role;
grant execute on function public.save_advance_rule(uuid, uuid, text, integer, integer, integer, text, date) to service_role;
