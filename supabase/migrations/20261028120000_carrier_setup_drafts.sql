-- LA-0.4 · A selected carrier may have incomplete contract details during setup.
-- These drafts are not tenant_carriers rows and never count as contracts or selling eligibility.

create table if not exists public.tenant_carrier_setup_drafts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  contract_level_text text check (contract_level_text is null or length(btrim(contract_level_text)) <= 20),
  effective_from date,
  writing_number text check (writing_number is null or length(btrim(writing_number)) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key (tenant_id, carrier_id)
);

alter table public.tenant_carrier_setup_drafts enable row level security;
revoke all on table public.tenant_carrier_setup_drafts from anon, authenticated, tenant_app;
grant select, insert, update, delete on table public.tenant_carrier_setup_drafts to service_role;

comment on table public.tenant_carrier_setup_drafts is
  'Incomplete Contracting form values only; never a contract or appointment and never an eligibility input.';
