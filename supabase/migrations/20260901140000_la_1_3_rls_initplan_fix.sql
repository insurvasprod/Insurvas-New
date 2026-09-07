-- LA-1.3 follow-up: evaluate the tenant setting once per statement rather than once per row.
-- The policies remain tenant-scoped; this only keeps the planner from re-evaluating the
-- immutable session setting for every product row.
drop policy if exists tenant_products_tenant_read on public.tenant_products;
create policy tenant_products_tenant_read on public.tenant_products
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists partner_products_tenant_read on public.partner_products;
create policy partner_products_tenant_read on public.partner_products
  for select to tenant_app
  using (exists (
    select 1 from public.partners p
    where p.id = partner_id
      and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  ));
