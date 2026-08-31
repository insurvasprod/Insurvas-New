-- SA-4.8 - platform compliance vendor registry.
-- Credentials are encrypted by the server before they reach this table. The table is control
-- plane data: tenant_app, anon and authenticated must never be able to read it.

create table if not exists public.compliance_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  vendor_type text not null check (vendor_type in ('dnc_scrub', 'litigator_scrub', 'consent_certificate', 'phone_validation')),
  endpoint text not null check (length(trim(endpoint)) between 1 and 2048),
  credentials_enc text,
  is_enabled boolean not null default false,
  priority integer not null default 0 check (priority >= 0),
  cost_per_lookup_cents integer not null default 0 check (cost_per_lookup_cents >= 0),
  last_success_at timestamptz,
  failure_count_24h integer not null default 0 check (failure_count_24h >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compliance_vendors_type_enabled_priority_idx
  on public.compliance_vendors (vendor_type, is_enabled, priority, name);

alter table public.compliance_vendors enable row level security;
revoke all on table public.compliance_vendors from public, anon, authenticated, tenant_app;
grant select, insert, update on table public.compliance_vendors to service_role;

create or replace function public.touch_compliance_vendor_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists compliance_vendors_touch_updated_at on public.compliance_vendors;
create trigger compliance_vendors_touch_updated_at
before update on public.compliance_vendors
for each row execute function public.touch_compliance_vendor_updated_at();
revoke all on function public.touch_compliance_vendor_updated_at() from public;
