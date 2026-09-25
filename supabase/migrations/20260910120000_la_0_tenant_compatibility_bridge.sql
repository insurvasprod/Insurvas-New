-- LA-0 compatibility bridge for the current organization-based Supabase project.
--
-- The application contract is tenant-based, while the existing project also serves an
-- organization-based control plane. This migration keeps the organization tables intact and
-- creates a 1:1 tenant facade for the agent plane. Existing rows are copied by stable UUID; no
-- existing organization, contact, carrier, or user rows are deleted.

create extension if not exists pg_trgm;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'tenant_user_role') then
    create type public.tenant_user_role as enum ('owner', 'producer', 'assistant', 'bookkeeper');
  end if;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('provisioning', 'active', 'suspended', 'cancelled')),
  plan_code text,
  onboarding_state text not null default 'complete',
  source_organization_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  suspended_at timestamptz,
  suspension_reason text
);

alter table public.tenants add column if not exists plan_code text;
alter table public.tenants add column if not exists billing_mode text not null default 'automatic';
alter table public.tenants add column if not exists onboarding_state text not null default 'complete';
alter table public.tenants add column if not exists source_organization_id uuid;
alter table public.tenants add column if not exists updated_at timestamptz not null default now();
alter table public.tenants add column if not exists suspended_at timestamptz;
alter table public.tenants add column if not exists suspension_reason text;
do $$
begin
  if to_regclass('public.organizations') is not null then
    insert into public.tenants (id, name, status, onboarding_state, source_organization_id, created_at, updated_at, suspended_at, suspension_reason)
    select o.id,
           o.name,
           case when o.account_status in ('suspended', 'cancelled', 'deleted') or o.status in ('suspended', 'archived') then
             case when o.account_status in ('cancelled', 'deleted') or o.status = 'archived' then 'cancelled' else 'suspended' end
           else 'active' end,
           'complete',
           o.id,
           o.created_at,
           o.updated_at,
           o.suspended_at,
           o.suspension_reason
      from public.organizations o
    on conflict (id) do update set
      name = excluded.name,
      status = excluded.status,
      source_organization_id = excluded.source_organization_id,
      updated_at = excluded.updated_at,
      suspended_at = excluded.suspended_at,
      suspension_reason = excluded.suspension_reason;
  end if;
end $$;

-- The existing public users table is the application profile beside auth.users. Add only the
-- fields required by the tenant session contract; credential verification remains Supabase Auth.
alter table public.users add column if not exists name text;
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists session_version integer not null default 0;
update public.users set name = coalesce(nullif(btrim(name), ''), nullif(btrim(display_name), ''), nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User') where name is null or btrim(name) = '';
alter table public.users alter column name set not null;
alter table public.users alter column full_name set default 'Invited user';
alter table public.users alter column display_name set default 'Invited user';

create table if not exists public.tenant_users (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.tenant_user_role not null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (tenant_id, user_id)
);

do $$
begin
  if to_regclass('public.organization_members') is not null and to_regclass('public.roles') is not null then
    insert into public.tenant_users (tenant_id, user_id, role, invited_at, accepted_at)
    select distinct on (m.organization_id, m.user_id)
           m.organization_id,
           m.user_id,
           case r.key
             when 'owner' then 'owner'::public.tenant_user_role
             when 'workspace_admin' then 'owner'::public.tenant_user_role
             when 'sales_agent_licensed' then 'producer'::public.tenant_user_role
             when 'sales_agent_unlicensed' then 'assistant'::public.tenant_user_role
             when 'accounting' then 'bookkeeper'::public.tenant_user_role
             else 'assistant'::public.tenant_user_role
           end,
           coalesce(m.invited_at, m.created_at, now()),
           coalesce(m.accepted_at, m.joined_at)
      from public.organization_members m
      join public.roles r on r.id = m.role_id
      where m.status = 'active'
        and m.organization_id in (select id from public.tenants)
      order by m.organization_id, m.user_id, (r.key in ('owner', 'workspace_admin')) desc, m.updated_at desc
    on conflict (tenant_id, user_id) do update set
      role = excluded.role,
      invited_at = excluded.invited_at,
      accepted_at = excluded.accepted_at;
  end if;
end $$;

create index if not exists tenant_users_user_idx on public.tenant_users(user_id, tenant_id);
create index if not exists tenant_users_role_idx on public.tenant_users(tenant_id, role);

create table if not exists public.tenant_entitlements (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  entitlement jsonb not null,
  computed_at timestamptz not null default now(),
  version bigint not null default 1
);

create or replace function public.la0_default_entitlement(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'tenant_id', t.id,
    'plan_code', coalesce(t.plan_code, 'individual'),
    'plan_version', 1,
    'status', case when t.status = 'suspended' then 'suspended' when t.status = 'cancelled' then 'cancelled' else 'active' end,
    'access', case when t.status = 'suspended' then 'read_only' when t.status = 'cancelled' then 'none' else 'full' end,
    'computed_at', now(),
    'features', jsonb_build_array('book_of_business','statement_ingestion','commission_ledger','appointment_vault','duplicate_detection','inbound_transfers','outbound_dialing','lead_import','callback_calendar'),
    'meters', '{}'::jsonb,
    'limits', jsonb_build_object('max_seats', 25, 'max_publishers', null, 'max_marketing_partners', null, 'max_affiliates', null, 'max_buffer_seats', 5, 'max_partner_users', 25),
    'period_start', now()
  )
  from public.tenants t
  where t.id = p_tenant_id;
$$;

create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entitlement jsonb;
begin
  v_entitlement := public.la0_default_entitlement(p_tenant_id);
  if v_entitlement is null then raise exception 'tenant_not_found'; end if;
  insert into public.tenant_entitlements (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update set entitlement = excluded.entitlement, computed_at = excluded.computed_at, version = public.tenant_entitlements.version + 1;
  return v_entitlement;
end;
$$;

create or replace function public.resolve_tenant_entitlement(p_tenant_id uuid)
returns table(feature_keys text[], max_seats integer, meter_allowances jsonb, plan_id uuid, subscription_status text)
language sql
stable
security invoker
set search_path = public
as $$
  select
    array(select jsonb_array_elements_text(e.entitlement -> 'features')),
    nullif((e.entitlement -> 'limits' ->> 'max_seats'), '')::integer,
    coalesce(e.entitlement -> 'meters', '{}'::jsonb),
    null::uuid,
    e.entitlement ->> 'status'
  from public.tenant_entitlements e
  where e.tenant_id = p_tenant_id;
$$;

insert into public.tenant_entitlements (tenant_id, entitlement)
select t.id, public.la0_default_entitlement(t.id)
from public.tenants t
where public.la0_default_entitlement(t.id) is not null
on conflict (tenant_id) do nothing;

-- Preserve the existing organization carrier table and make its platform rows usable by LA-0.
-- Organization-specific carrier rows remain excluded by the LA-0 service query.
alter table public.carriers add column if not exists organization_id uuid;
alter table public.carriers alter column organization_id drop not null;
alter table public.carriers add column if not exists is_active boolean not null default true;
alter table public.carriers add column if not exists sort_order integer not null default 0;
alter table public.carriers add column if not exists status text not null default 'active';
update public.carriers set is_active = (status = 'active') where is_active is null;
create index if not exists la0_carriers_platform_order_idx on public.carriers (is_active, sort_order, name) where organization_id is null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  category text not null default 'life',
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.products (code, name, category, sort_order)
select x.code, x.name, x.category, x.sort_order
from (values
  ('final_expense','Final Expense','life',10),
  ('term_life','Term Life','life',20),
  ('whole_life','Whole Life','life',30),
  ('iul','Indexed Universal Life','life',40),
  ('medicare_advantage','Medicare Advantage','health',50),
  ('annuity','Annuity','retirement',60)
) as x(code,name,category,sort_order)
where not exists (select 1 from public.products p where p.code = x.code);

insert into public.carriers (code, name, organization_id, status, is_active, sort_order)
select x.code, x.name, null, 'active', true, x.sort_order
from (values
  ('mutual_of_omaha','Mutual of Omaha',10), ('aetna','Aetna / CVS',20), ('americo','Americo',30),
  ('foresters','Foresters',40), ('gerber','Gerber Life',50), ('transamerica','Transamerica',60),
  ('national_life','National Life Group',70), ('american_national','American National',80)
) as x(code,name,sort_order)
where not exists (select 1 from public.carriers c where c.code = x.code and c.organization_id is null);

create table if not exists public.tenant_carriers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  contract_level_bp integer not null check (contract_level_bp between 0 and 100000),
  writing_number text not null check (length(trim(writing_number)) between 1 and 120),
  effective_from date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, carrier_id, effective_from)
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
  unique (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, effective_from)
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
  unique (tenant_id, carrier_id, product_code, effective_from)
);

create index if not exists tenant_carriers_lookup_idx on public.tenant_carriers (tenant_id, carrier_id, effective_from desc);
create index if not exists commission_schedules_lookup_idx on public.commission_schedules (tenant_id, carrier_id, product_code, policy_year, effective_from desc);
create index if not exists advance_rules_lookup_idx on public.advance_rules (tenant_id, carrier_id, product_code, effective_from desc);

create or replace function public.save_tenant_carrier(p_tenant_id uuid, p_carrier_id uuid, p_contract_level_bp integer, p_writing_number text, p_effective_from date)
returns public.tenant_carriers language plpgsql security invoker set search_path = public as $$
declare v_row public.tenant_carriers;
begin
  if not exists (select 1 from public.carriers where id = p_carrier_id and organization_id is null and is_active) then raise exception 'Carrier is not available'; end if;
  update public.tenant_carriers set is_active = false where tenant_id = p_tenant_id and carrier_id = p_carrier_id and is_active;
  insert into public.tenant_carriers (tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active)
  values (p_tenant_id, p_carrier_id, p_contract_level_bp, trim(p_writing_number), p_effective_from, true)
  on conflict (tenant_id, carrier_id, effective_from) do update set contract_level_bp = excluded.contract_level_bp, writing_number = excluded.writing_number, is_active = true
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.save_commission_schedule(p_tenant_id uuid, p_carrier_id uuid, p_product_code text, p_contract_level_bp integer, p_policy_year integer, p_rate_bp integer, p_effective_from date)
returns public.commission_schedules language plpgsql security invoker set search_path = public as $$
declare v_row public.commission_schedules;
begin
  if not exists (select 1 from public.tenant_carriers where tenant_id = p_tenant_id and carrier_id = p_carrier_id and contract_level_bp = p_contract_level_bp and effective_from <= p_effective_from) then raise exception 'Save the carrier contract level before its commission schedule'; end if;
  insert into public.commission_schedules (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from)
  values (p_tenant_id, p_carrier_id, p_product_code, p_contract_level_bp, p_policy_year, p_rate_bp, p_effective_from)
  on conflict (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, effective_from) do update set rate_bp = excluded.rate_bp
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.save_advance_rule(p_tenant_id uuid, p_carrier_id uuid, p_product_code text, p_advance_months integer, p_advance_pct_bp integer, p_clawback_months integer, p_clawback_type text, p_effective_from date)
returns public.advance_rules language plpgsql security invoker set search_path = public as $$
declare v_row public.advance_rules;
begin
  if not exists (select 1 from public.tenant_carriers where tenant_id = p_tenant_id and carrier_id = p_carrier_id and is_active and effective_from <= p_effective_from) then raise exception 'Save the carrier contract level before its advance rule'; end if;
  insert into public.advance_rules (tenant_id, carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from)
  values (p_tenant_id, p_carrier_id, p_product_code, p_advance_months, p_advance_pct_bp, p_clawback_months, p_clawback_type, p_effective_from)
  on conflict (tenant_id, carrier_id, product_code, effective_from) do update set advance_months = excluded.advance_months, advance_pct_bp = excluded.advance_pct_bp, clawback_months = excluded.clawback_months, clawback_type = excluded.clawback_type
  returning * into v_row;
  return v_row;
end; $$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict, state text not null check (state ~ '^[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active','terminated')), effective_from date not null, terminated_at date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (terminated_at is null or terminated_at >= effective_from), unique (tenant_id, carrier_id, state, effective_from)
);
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'), license_number text not null, expires_at date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, state)
);
create table if not exists public.eo_policies (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier text not null, policy_number text not null, expires_at date not null, coverage_amount_cents bigint not null check (coverage_amount_cents >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, policy_number)
);
create table if not exists public.ce_records (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'), credits_required integer not null check (credits_required between 0 and 10000), credits_completed integer not null check (credits_completed between 0 and 10000), deadline date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, state)
);
create index if not exists appointments_tenant_lookup_idx on public.appointments (tenant_id, carrier_id, state, effective_from desc);
create index if not exists licenses_expiry_idx on public.licenses (tenant_id, expires_at);
create index if not exists eo_policies_expiry_idx on public.eo_policies (tenant_id, expires_at);
create index if not exists ce_records_expiry_idx on public.ce_records (tenant_id, deadline);

create or replace function public.save_appointments(p_tenant_id uuid, p_rows jsonb)
returns setof public.appointments language plpgsql security invoker set search_path = public as $$
begin
  if p_tenant_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then raise exception 'invalid_appointment_batch'; end if;
  return query insert into public.appointments (tenant_id, carrier_id, state, status, effective_from, terminated_at)
  select p_tenant_id, x.carrier_id, upper(x.state), x.status, x.effective_from, x.terminated_at
  from jsonb_to_recordset(p_rows) x(carrier_id uuid, state text, status text, effective_from date, terminated_at date)
  on conflict (tenant_id, carrier_id, state, effective_from) do update set status = excluded.status, terminated_at = excluded.terminated_at
  returning *;
end; $$;

create or replace function public.save_license(p_tenant_id uuid, p_state text, p_license_number text, p_expires_at date)
returns public.licenses language plpgsql security invoker set search_path = public as $$ declare v public.licenses; begin
  insert into public.licenses (tenant_id,state,license_number,expires_at) values (p_tenant_id,upper(trim(p_state)),trim(p_license_number),p_expires_at)
  on conflict (tenant_id,state) do update set license_number=excluded.license_number,expires_at=excluded.expires_at returning * into v; return v; end; $$;
create or replace function public.save_eo_policy(p_tenant_id uuid, p_carrier text, p_policy_number text, p_expires_at date, p_coverage_amount_cents bigint)
returns public.eo_policies language plpgsql security invoker set search_path = public as $$ declare v public.eo_policies; begin
  insert into public.eo_policies (tenant_id,carrier,policy_number,expires_at,coverage_amount_cents) values (p_tenant_id,trim(p_carrier),trim(p_policy_number),p_expires_at,p_coverage_amount_cents)
  on conflict (tenant_id,policy_number) do update set carrier=excluded.carrier,expires_at=excluded.expires_at,coverage_amount_cents=excluded.coverage_amount_cents returning * into v; return v; end; $$;
create or replace function public.save_ce_record(p_tenant_id uuid, p_state text, p_credits_required integer, p_credits_completed integer, p_deadline date)
returns public.ce_records language plpgsql security invoker set search_path = public as $$ declare v public.ce_records; begin
  insert into public.ce_records (tenant_id,state,credits_required,credits_completed,deadline) values (p_tenant_id,upper(trim(p_state)),p_credits_required,p_credits_completed,p_deadline)
  on conflict (tenant_id,state) do update set credits_required=excluded.credits_required,credits_completed=excluded.credits_completed,deadline=excluded.deadline returning * into v; return v; end; $$;

-- Add LA-0 tenant columns to the existing organization contact records. The IDs are deliberately
-- preserved so existing contact links continue to work.
alter table public.households add column if not exists tenant_id uuid;
alter table public.households add column if not exists organization_id uuid;
alter table public.households add column if not exists address_search text;
alter table public.contacts add column if not exists tenant_id uuid;
alter table public.contacts add column if not exists organization_id uuid;
alter table public.contacts add column if not exists name_search text;
alter table public.contact_phones add column if not exists tenant_id uuid;
alter table public.contact_phones add column if not exists organization_id uuid;
alter table public.contact_phones add column if not exists type text default 'other';
alter table public.contact_emails add column if not exists tenant_id uuid;
alter table public.contact_emails add column if not exists organization_id uuid;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='households' and column_name='organization_id') then
    update public.households set tenant_id = coalesce(tenant_id, organization_id), address_search = coalesce(address_search, lower(regexp_replace(concat_ws(' ', address_line1, city, state, postal_code), '[^a-zA-Z0-9]+', '', 'g')));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacts' and column_name='organization_id') then
    update public.contacts set tenant_id = coalesce(tenant_id, organization_id), name_search = coalesce(name_search, lower(regexp_replace(trim(concat_ws(' ', first_name, last_name)), '[^a-zA-Z0-9]+', '', 'g')));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contact_phones' and column_name='organization_id') then
    update public.contact_phones set tenant_id = coalesce(tenant_id, organization_id), type = coalesce(type, phone_type, 'other');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contact_emails' and column_name='organization_id') then
    update public.contact_emails set tenant_id = coalesce(tenant_id, organization_id);
  end if;
end $$;

create table if not exists public.field_schema (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity text not null default 'contact', field_key text not null, label text not null, type text not null,
  options jsonb not null default '[]'::jsonb, is_required boolean not null default false, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, entity, field_key)
);
create table if not exists public.merge_log (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  kept_id uuid not null references public.contacts(id) on delete restrict, merged_id uuid not null references public.contacts(id) on delete restrict,
  field_choices jsonb not null default '{}'::jsonb, kept_snapshot jsonb not null, merged_snapshot jsonb not null,
  kept_phones jsonb not null default '[]'::jsonb, merged_phones jsonb not null default '[]'::jsonb, kept_emails jsonb not null default '[]'::jsonb, merged_emails jsonb not null default '[]'::jsonb,
  merged_by uuid references public.users(id) on delete set null, merged_at timestamptz not null default now(), reversed_at timestamptz, check (kept_id <> merged_id)
);
create index if not exists contacts_tenant_idx on public.contacts(tenant_id, created_at desc);
create index if not exists contacts_tenant_phone_idx on public.contacts(tenant_id, primary_phone);
create index if not exists contacts_name_search_trgm_idx on public.contacts using gin(name_search gin_trgm_ops);
create index if not exists contact_phones_tenant_phone_idx on public.contact_phones(tenant_id, phone);
create index if not exists contact_emails_tenant_email_idx on public.contact_emails(tenant_id, email);
create index if not exists merge_log_tenant_idx on public.merge_log(tenant_id, merged_at desc);

create or replace function public.find_contact_duplicates(p_tenant_id uuid, p_name_search text, p_dob date default null, p_phone text default null, p_address_search text default null, p_address_hash text default null, p_limit integer default 20)
returns table(contact_id uuid, household_id uuid, first_name text, last_name text, dob date, primary_phone text, state text, custom_fields jsonb, address_line1 text, city text, postal_code text, score numeric, confidence text, matched_on text[])
language sql stable security invoker set search_path = public as $$
with candidates as (
  select c.id contact_id, c.household_id, c.first_name, c.last_name, c.dob, c.primary_phone, c.state, c.custom_fields,
    h.address_line1, h.city, h.postal_code,
    ((case when p_phone is not null and c.primary_phone = p_phone then .35 else 0 end) +
     (case when p_dob is not null and c.dob = p_dob then .25 else 0 end) +
     (case when p_address_hash is not null and h.address_hash = p_address_hash then .20 else 0 end) +
     (case when nullif(p_name_search,'') is not null then greatest(similarity(coalesce(c.name_search,''),p_name_search),0)*.40 else 0 end) +
     (case when nullif(p_address_search,'') is not null and h.address_search is not null then greatest(similarity(h.address_search,p_address_search),0)*.20 else 0 end))::numeric raw_score,
    array_remove(array[case when p_phone is not null and c.primary_phone = p_phone then 'phone' end, case when p_dob is not null and c.dob = p_dob then 'dob' end, case when p_address_hash is not null and h.address_hash = p_address_hash then 'address' end, case when nullif(p_name_search,'') is not null and similarity(coalesce(c.name_search,''),p_name_search) >= .45 then 'name' end],null) matched_on
  from public.contacts c left join public.households h on h.id=c.household_id and h.tenant_id=p_tenant_id
  where c.tenant_id=p_tenant_id and c.merged_into_id is null and ((p_phone is not null and c.primary_phone=p_phone) or (p_dob is not null and c.dob=p_dob) or (p_address_hash is not null and h.address_hash=p_address_hash) or (nullif(p_name_search,'') is not null and coalesce(c.name_search,'') % p_name_search) or (nullif(p_address_search,'') is not null and coalesce(h.address_search,'') % p_address_search))
), filtered as (select *, round(raw_score,4) rounded_score from candidates where raw_score >= .45)
select contact_id,household_id,first_name,last_name,dob,primary_phone,state,custom_fields,address_line1,city,postal_code,rounded_score,case when rounded_score >= .78 then 'high' when rounded_score >= .60 then 'medium' else 'low' end,matched_on
from filtered order by rounded_score desc, contact_id limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.save_contact(p_tenant_id uuid, p_first_name text, p_last_name text, p_dob date, p_primary_phone text, p_state text, p_name_search text, p_custom_fields jsonb, p_address_hash text, p_address_search text, p_address_line1 text, p_city text, p_postal_code text, p_phones jsonb default '[]'::jsonb, p_emails jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_household_id uuid; v_contact_id uuid; item jsonb;
begin
  if jsonb_typeof(coalesce(p_custom_fields,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_phones,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_emails,'[]'::jsonb)) <> 'array' then raise exception 'invalid_contact_payload'; end if;
  if p_address_hash is not null then
    insert into public.households (tenant_id, organization_id, address_hash, address_line1, city, state, postal_code, address_search)
    values (p_tenant_id,p_tenant_id,p_address_hash,coalesce(nullif(trim(p_address_line1),''),''),coalesce(nullif(trim(p_city),''),''),nullif(upper(trim(p_state)),''),coalesce(nullif(trim(p_postal_code),''),''),p_address_search)
    on conflict do nothing;
    select h.id into v_household_id from public.households h where h.tenant_id=p_tenant_id and h.address_hash=p_address_hash limit 1;
  end if;
  insert into public.contacts (tenant_id,organization_id,household_id,first_name,last_name,dob,primary_phone,address_line1,city,postal_code,state,name_search,custom_fields)
  values (p_tenant_id,p_tenant_id,v_household_id,trim(p_first_name),trim(p_last_name),p_dob,nullif(trim(p_primary_phone),''),coalesce(nullif(trim(p_address_line1),''),''),coalesce(nullif(trim(p_city),''),''),coalesce(nullif(trim(p_postal_code),''),''),nullif(upper(trim(p_state)),''),p_name_search,coalesce(p_custom_fields,'{}'::jsonb)) returning id into v_contact_id;
  for item in select value from jsonb_array_elements(p_phones) loop
    insert into public.contact_phones (tenant_id,organization_id,contact_id,phone,type,phone_type,is_primary) values (p_tenant_id,p_tenant_id,v_contact_id,item->>'phone',coalesce(item->>'type','other'),coalesce(item->>'type','other'),coalesce((item->>'is_primary')::boolean,false)) on conflict (contact_id,phone) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(p_emails) loop
    insert into public.contact_emails (tenant_id,organization_id,contact_id,email,is_primary) values (p_tenant_id,p_tenant_id,v_contact_id,lower(trim(item->>'email')),coalesce((item->>'is_primary')::boolean,false)) on conflict (contact_id,email) do nothing;
  end loop;
  return v_contact_id;
end; $$;

create or replace function public.save_field_schema(p_tenant_id uuid,p_entity text,p_field_key text,p_label text,p_type text,p_options jsonb,p_is_required boolean,p_sort_order integer)
returns public.field_schema language sql security invoker set search_path = public as $$
  insert into public.field_schema(tenant_id,entity,field_key,label,type,options,is_required,sort_order) values(p_tenant_id,p_entity,lower(trim(p_field_key)),trim(p_label),p_type,coalesce(p_options,'[]'::jsonb),coalesce(p_is_required,false),p_sort_order)
  on conflict(tenant_id,entity,field_key) do update set label=excluded.label,type=excluded.type,options=excluded.options,is_required=excluded.is_required,sort_order=excluded.sort_order returning *;
$$;

create or replace function public.merge_contacts(p_tenant_id uuid,p_kept_id uuid,p_merged_id uuid,p_field_choices jsonb,p_merged_by uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare kept public.contacts%rowtype; merged public.contacts%rowtype; log_id uuid; kept_phones jsonb; merged_phones jsonb; kept_emails jsonb; merged_emails jsonb;
begin
  if p_kept_id=p_merged_id then raise exception 'Choose two different contacts'; end if;
  select * into kept from public.contacts where id=p_kept_id and tenant_id=p_tenant_id and merged_into_id is null for update;
  select * into merged from public.contacts where id=p_merged_id and tenant_id=p_tenant_id and merged_into_id is null for update;
  if kept.id is null or merged.id is null then raise exception 'Both contacts must belong to this tenant'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into kept_phones from public.contact_phones p where p.contact_id=kept.id;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into merged_phones from public.contact_phones p where p.contact_id=merged.id;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into kept_emails from public.contact_emails e where e.contact_id=kept.id;
  select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into merged_emails from public.contact_emails e where e.contact_id=merged.id;
  insert into public.merge_log(tenant_id,kept_id,merged_id,field_choices,kept_snapshot,merged_snapshot,kept_phones,merged_phones,kept_emails,merged_emails,merged_by) values(p_tenant_id,kept.id,merged.id,coalesce(p_field_choices,'{}'::jsonb),to_jsonb(kept),to_jsonb(merged),kept_phones,merged_phones,kept_emails,merged_emails,p_merged_by) returning id into log_id;
  update public.contacts set first_name=case when p_field_choices->>'first_name'='merged' then merged.first_name else kept.first_name end,last_name=case when p_field_choices->>'last_name'='merged' then merged.last_name else kept.last_name end,dob=case when p_field_choices->>'dob'='merged' then merged.dob else kept.dob end,primary_phone=case when p_field_choices->>'primary_phone'='merged' then merged.primary_phone else kept.primary_phone end,state=case when p_field_choices->>'state'='merged' then merged.state else kept.state end,custom_fields=case when p_field_choices->>'custom_fields'='merged' then merged.custom_fields else kept.custom_fields end,name_search=lower(regexp_replace(trim((case when p_field_choices->>'first_name'='merged' then merged.first_name else kept.first_name end)||' '||(case when p_field_choices->>'last_name'='merged' then merged.last_name else kept.last_name end)),'[^a-zA-Z0-9]+','','g')) where id=kept.id;
  insert into public.contact_phones(tenant_id,organization_id,contact_id,phone,type,phone_type,is_primary) select p_tenant_id,p_tenant_id,kept.id,item->>'phone',coalesce(item->>'type',item->>'phone_type','other'),coalesce(item->>'type',item->>'phone_type','other'),coalesce((item->>'is_primary')::boolean,false) from jsonb_array_elements(merged_phones) item on conflict(contact_id,phone) do nothing;
  insert into public.contact_emails(tenant_id,organization_id,contact_id,email,is_primary) select p_tenant_id,p_tenant_id,kept.id,item->>'email',coalesce((item->>'is_primary')::boolean,false) from jsonb_array_elements(merged_emails) item on conflict(contact_id,email) do nothing;
  update public.contacts set merged_into_id=kept.id where id=merged.id;
  return log_id;
end; $$;

create or replace function public.undo_contact_merge(p_tenant_id uuid,p_merge_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare log_row public.merge_log%rowtype; item jsonb;
begin
  select * into log_row from public.merge_log where id=p_merge_id and tenant_id=p_tenant_id and reversed_at is null for update;
  if log_row.id is null then raise exception 'Merge not found or already undone'; end if;
  update public.contacts set first_name=log_row.kept_snapshot->>'first_name',last_name=log_row.kept_snapshot->>'last_name',dob=nullif(log_row.kept_snapshot->>'dob','')::date,primary_phone=log_row.kept_snapshot->>'primary_phone',state=log_row.kept_snapshot->>'state',custom_fields=coalesce(log_row.kept_snapshot->'custom_fields','{}'::jsonb),name_search=log_row.kept_snapshot->>'name_search' where id=log_row.kept_id and tenant_id=p_tenant_id;
  update public.contacts set first_name=log_row.merged_snapshot->>'first_name',last_name=log_row.merged_snapshot->>'last_name',dob=nullif(log_row.merged_snapshot->>'dob','')::date,primary_phone=log_row.merged_snapshot->>'primary_phone',state=log_row.merged_snapshot->>'state',custom_fields=coalesce(log_row.merged_snapshot->'custom_fields','{}'::jsonb),name_search=log_row.merged_snapshot->>'name_search',merged_into_id=null where id=log_row.merged_id and tenant_id=p_tenant_id;
  delete from public.contact_phones where contact_id in(log_row.kept_id,log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_phones) loop insert into public.contact_phones(id,tenant_id,organization_id,contact_id,phone,type,phone_type,is_primary) values((item->>'id')::uuid,p_tenant_id,p_tenant_id,log_row.kept_id,item->>'phone',coalesce(item->>'type',item->>'phone_type','other'),coalesce(item->>'type',item->>'phone_type','other'),coalesce((item->>'is_primary')::boolean,false)); end loop;
  for item in select value from jsonb_array_elements(log_row.merged_phones) loop insert into public.contact_phones(id,tenant_id,organization_id,contact_id,phone,type,phone_type,is_primary) values((item->>'id')::uuid,p_tenant_id,p_tenant_id,log_row.merged_id,item->>'phone',coalesce(item->>'type',item->>'phone_type','other'),coalesce(item->>'type',item->>'phone_type','other'),coalesce((item->>'is_primary')::boolean,false)); end loop;
  update public.merge_log set reversed_at=now() where id=log_row.id;
  return log_row.id;
end; $$;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(), actor_type text not null, actor_id uuid, action text not null,
  target_type text, target_id uuid, reason text, ip text, user_agent text, metadata jsonb not null default '{}', ts timestamptz not null default now()
);
create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(), actor_type text not null, user_id uuid, admin_id uuid, email text not null,
  ip text, user_agent text, success boolean not null, failure_reason text, ts timestamptz not null default now()
);

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade, token_hash text not null unique, expires_at timestamptz not null,
  created_by uuid, purpose text not null default 'invite', accepted_at timestamptz, created_at timestamptz not null default now()
);
alter table public.user_invitations add column if not exists tenant_id uuid;
alter table public.user_invitations add column if not exists purpose text not null default 'invite';
alter table public.user_invitations add column if not exists accepted_at timestamptz;

create or replace function public.tenant_invite_user(p_name text,p_email text,p_role public.tenant_user_role,p_tenant_id uuid,p_token_hash text,p_expires_at timestamptz,p_created_by uuid)
returns table(user_id uuid,tenant_id uuid) language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_role uuid; v_org uuid;
begin
  if not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception 'tenant_not_found'; end if;
  if exists(select 1 from public.users where lower(email)=lower(trim(p_email))) then raise exception 'email_exists'; end if;
  select source_organization_id into v_org from public.tenants where id=p_tenant_id;
  select id into v_role from public.roles where key=case p_role::text when 'owner' then 'owner' when 'producer' then 'sales_agent_licensed' when 'assistant' then 'sales_agent_unlicensed' when 'bookkeeper' then 'accounting' end limit 1;
  insert into public.users(email,name,full_name,display_name,status,organization_id,role_id) values(lower(trim(p_email)),trim(p_name),trim(p_name),trim(p_name),'active',v_org,v_role) returning id into v_user;
  insert into public.tenant_users(tenant_id,user_id,role,accepted_at) values(p_tenant_id,v_user,p_role,null);
  insert into public.user_invitations(user_id,tenant_id,token_hash,expires_at,created_by,purpose) values(v_user,p_tenant_id,p_token_hash,p_expires_at,null,'invite');
  return query select v_user,p_tenant_id;
end; $$;

create or replace function public.tenant_invite_user_with_limit(p_name text,p_email text,p_role public.tenant_user_role,p_tenant_id uuid,p_token_hash text,p_expires_at timestamptz,p_created_by uuid,p_max_buffer_seats integer default null)
returns table(user_id uuid,tenant_id uuid) language plpgsql security definer set search_path = public as $$
begin
  if p_role='assistant' and p_max_buffer_seats is not null and (select count(*) from public.tenant_users where tenant_id=p_tenant_id and role='assistant') >= p_max_buffer_seats then raise exception 'max_buffer_seats:%:%',(select count(*) from public.tenant_users where tenant_id=p_tenant_id and role='assistant'),p_max_buffer_seats; end if;
  return query select * from public.tenant_invite_user(p_name,p_email,p_role,p_tenant_id,p_token_hash,p_expires_at,p_created_by);
end; $$;

create or replace function public.tenant_update_member_role(p_tenant_id uuid,p_user_id uuid,p_role public.tenant_user_role)
returns table(old_role public.tenant_user_role,new_role public.tenant_user_role) language plpgsql security definer set search_path = public as $$
declare v_old public.tenant_user_role; v_org uuid; v_role uuid;
begin
  select role into v_old from public.tenant_users where tenant_id=p_tenant_id and user_id=p_user_id for update;
  if v_old is null then raise exception 'member_not_found'; end if;
  if v_old='owner' and p_role<>'owner' and (select count(*) from public.tenant_users where tenant_id=p_tenant_id and role='owner') <= 1 then raise exception 'last_owner'; end if;
  update public.tenant_users set role=p_role where tenant_id=p_tenant_id and user_id=p_user_id;
  select source_organization_id into v_org from public.tenants where id=p_tenant_id;
  select id into v_role from public.roles where key=case p_role::text when 'owner' then 'owner' when 'producer' then 'sales_agent_licensed' when 'assistant' then 'sales_agent_unlicensed' when 'bookkeeper' then 'accounting' end limit 1;
  if v_org is not null and to_regclass('public.organization_members') is not null then update public.organization_members set role_id=v_role, updated_at=now() where organization_id=v_org and user_id=p_user_id and status='active'; end if;
  return query select v_old,p_role;
end; $$;

create or replace function public.tenant_update_member_role_with_limit(p_tenant_id uuid,p_user_id uuid,p_role public.tenant_user_role,p_max_buffer_seats integer default null)
returns table(old_role public.tenant_user_role,new_role public.tenant_user_role) language plpgsql security definer set search_path = public as $$ begin
  if p_role='assistant' and p_max_buffer_seats is not null and (select count(*) from public.tenant_users where tenant_id=p_tenant_id and role='assistant' and user_id<>p_user_id) >= p_max_buffer_seats then raise exception 'max_buffer_seats'; end if;
  return query select * from public.tenant_update_member_role(p_tenant_id,p_user_id,p_role);
end; $$;

-- The tenant_app role is deliberately non-bypass-RLS. These policies are the database backstop
-- for the direct pg client used by /api/app/me and future tenant reads.
grant usage on schema public to tenant_app;
grant select on public.tenants,public.tenant_users,public.users,public.tenant_entitlements,public.carriers,public.products,public.tenant_carriers,public.commission_schedules,public.advance_rules,public.appointments,public.licenses,public.eo_policies,public.ce_records,public.households,public.contacts,public.contact_phones,public.contact_emails,public.field_schema,public.merge_log to tenant_app;
grant all on public.tenants,public.tenant_users,public.users,public.tenant_entitlements,public.carriers,public.products,public.tenant_carriers,public.commission_schedules,public.advance_rules,public.appointments,public.licenses,public.eo_policies,public.ce_records,public.households,public.contacts,public.contact_phones,public.contact_emails,public.field_schema,public.merge_log,public.audit_log,public.login_events,public.user_invitations to service_role;

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.tenant_entitlements enable row level security;
alter table public.carriers enable row level security;
alter table public.tenant_carriers enable row level security;
alter table public.commission_schedules enable row level security;
alter table public.advance_rules enable row level security;
alter table public.appointments enable row level security;
alter table public.licenses enable row level security;
alter table public.eo_policies enable row level security;
alter table public.ce_records enable row level security;
alter table public.households enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_phones enable row level security;
alter table public.contact_emails enable row level security;
alter table public.field_schema enable row level security;
alter table public.merge_log enable row level security;

drop policy if exists la0_tenant_self_read on public.tenants;
create policy la0_tenant_self_read on public.tenants for select to tenant_app using (id = nullif(current_setting('app.tenant_id',true),'')::uuid);
drop policy if exists la0_tenant_members_read on public.tenant_users;
create policy la0_tenant_members_read on public.tenant_users for select to tenant_app using (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
drop policy if exists la0_tenant_users_read on public.users;
create policy la0_tenant_users_read on public.users for select to tenant_app using (id in (select tu.user_id from public.tenant_users tu where tu.tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid));
drop policy if exists la0_entitlement_read on public.tenant_entitlements;
create policy la0_entitlement_read on public.tenant_entitlements for select to tenant_app using (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
drop policy if exists la0_carriers_read on public.carriers;
create policy la0_carriers_read on public.carriers for select to tenant_app using (is_active and organization_id is null);

do $$
declare t text;
begin
  foreach t in array array['tenant_carriers','commission_schedules','advance_rules','appointments','licenses','eo_policies','ce_records','households','contacts','contact_phones','contact_emails','field_schema','merge_log'] loop
    execute format('drop policy if exists la0_%s_read on public.%I', t, t);
    execute format('create policy la0_%s_read on public.%I for select to tenant_app using (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)', t, t);
  end loop;
end $$;

revoke all on function public.la0_default_entitlement(uuid) from public,anon,authenticated;
revoke all on function public.refresh_tenant_entitlement(uuid) from public,anon,authenticated;
revoke all on function public.resolve_tenant_entitlement(uuid) from public,anon,authenticated;
revoke all on function public.save_tenant_carrier(uuid,uuid,integer,text,date) from public,anon,authenticated;
revoke all on function public.save_commission_schedule(uuid,uuid,text,integer,integer,integer,date) from public,anon,authenticated;
revoke all on function public.save_advance_rule(uuid,uuid,text,integer,integer,integer,text,date) from public,anon,authenticated;
revoke all on function public.save_appointments(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_license(uuid,text,text,date) from public,anon,authenticated;
revoke all on function public.save_eo_policy(uuid,text,text,date,bigint) from public,anon,authenticated;
revoke all on function public.save_ce_record(uuid,text,integer,integer,date) from public,anon,authenticated;
revoke all on function public.find_contact_duplicates(uuid,text,date,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.save_contact(uuid,text,text,date,text,text,text,jsonb,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.save_field_schema(uuid,text,text,text,text,jsonb,boolean,integer) from public,anon,authenticated;
revoke all on function public.merge_contacts(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.undo_contact_merge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.tenant_invite_user(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.tenant_invite_user_with_limit(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.tenant_update_member_role(uuid,uuid,public.tenant_user_role) from public,anon,authenticated;
revoke all on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) from public,anon,authenticated;
grant execute on function public.refresh_tenant_entitlement(uuid),public.resolve_tenant_entitlement(uuid),public.save_tenant_carrier(uuid,uuid,integer,text,date),public.save_commission_schedule(uuid,uuid,text,integer,integer,integer,date),public.save_advance_rule(uuid,uuid,text,integer,integer,integer,text,date),public.save_appointments(uuid,jsonb),public.save_license(uuid,text,text,date),public.save_eo_policy(uuid,text,text,date,bigint),public.save_ce_record(uuid,text,integer,integer,date),public.find_contact_duplicates(uuid,text,date,text,text,text,integer),public.save_contact(uuid,text,text,date,text,text,text,jsonb,text,text,text,text,text,jsonb,jsonb),public.save_field_schema(uuid,text,text,text,text,jsonb,boolean,integer),public.merge_contacts(uuid,uuid,uuid,jsonb,uuid),public.undo_contact_merge(uuid,uuid),public.tenant_invite_user(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid),public.tenant_invite_user_with_limit(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer),public.tenant_update_member_role(uuid,uuid,public.tenant_user_role),public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) to service_role;
