-- Settings › Carrier library: which carriers require E&O cover in force.
--
-- Two boards count it: Agency profile ("E&O policy expires in 41 days · six carriers require it")
-- and States & licences ("Six carrier appointments require E&O in force"). Nothing recorded it, so
-- both counts would have been invented. It is a term of the carrier's contract with the agency, so
-- it is kept per tenant and carrier, beside the contract rows — not on tenant_carriers itself,
-- whose rows are effective-dated and re-inserted on every contract change, which would drop a flag
-- the owner set once.
--
-- Additive and idempotent. Written by the service role after the API has checked the caller is an
-- owner, the same arrangement as the rest of the carrier library.

create table if not exists public.tenant_carrier_requirements (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  requires_eo boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, carrier_id)
);
create index if not exists tenant_carrier_requirements_carrier_idx on public.tenant_carrier_requirements (carrier_id);
create index if not exists tenant_carrier_requirements_updated_by_idx on public.tenant_carrier_requirements (updated_by);

alter table public.tenant_carrier_requirements enable row level security;
revoke all on public.tenant_carrier_requirements from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_carrier_requirements to service_role;
grant select on public.tenant_carrier_requirements to tenant_app;
drop policy if exists tenant_carrier_requirements_read on public.tenant_carrier_requirements;
create policy tenant_carrier_requirements_read on public.tenant_carrier_requirements
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
