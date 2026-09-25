-- LA-2.2: persist a reviewed CSV column mapping per tenant/vendor/product.
-- This migration is additive and intentionally remains local until a schema owner promotes it.

create table if not exists public.tenant_import_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid not null references public.tenant_lead_vendors(id) on delete cascade,
  product_code text not null check (char_length(btrim(product_code)) between 1 and 80),
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, vendor_id, product_code)
);

create or replace function public.enforce_import_mapping_vendor_tenant()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $function$
begin
  if not exists (
    select 1 from public.tenant_lead_vendors
     where id = new.vendor_id and tenant_id = new.tenant_id
  ) then
    raise exception 'IMPORT_MAPPING_VENDOR_SCOPE_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_import_mapping_vendor_tenant on public.tenant_import_mappings;
create trigger tenant_import_mapping_vendor_tenant
before insert or update of tenant_id, vendor_id on public.tenant_import_mappings
for each row execute function public.enforce_import_mapping_vendor_tenant();

create index if not exists tenant_import_mappings_tenant_product_idx
  on public.tenant_import_mappings (tenant_id, product_code, updated_at desc);

alter table public.tenant_import_mappings enable row level security;
drop policy if exists tenant_import_mappings_tenant_scoped on public.tenant_import_mappings;
create policy tenant_import_mappings_tenant_scoped on public.tenant_import_mappings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_import_mappings from anon, authenticated, public;
grant select, insert, update on public.tenant_import_mappings to tenant_app;
grant select, insert, update on public.tenant_import_mappings to service_role;
revoke all on function public.enforce_import_mapping_vendor_tenant() from public, anon, authenticated, tenant_app;
grant execute on function public.enforce_import_mapping_vendor_tenant() to service_role;
