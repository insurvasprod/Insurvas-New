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
