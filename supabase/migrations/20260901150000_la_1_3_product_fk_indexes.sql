-- LA-1.3 follow-up: cover foreign-key lookups used by approval and catalog joins.
create index if not exists tenant_products_product_code_idx
  on public.tenant_products (product_code);

create index if not exists partner_products_product_code_idx
  on public.partner_products (product_code);

create index if not exists partner_products_approved_by_idx
  on public.partner_products (approved_by);
