-- LA-3.6 / 3.25 — "Copy to my agency" for a platform carrier product.
--
-- Platform product rows (tenant_id null) are shared, so an agency that wants different issue ages,
-- face limits, a different per-$1,000 band or other payment methods copies the row and edits its copy.
-- `copied_from_id` names the platform row a tenant row replaces, so a reader can show the agency's
-- copy in its place instead of both (lib/salesSettings/carriers.ts preferTenantCopies). The platform
-- row is never changed by a copy.
--
--   carrier_products   +1 column   copied_from_id → carrier_products (tenant rows only, one copy per row)
--
-- Down (only while no row has copied_from_id set):
--   drop index public.carrier_products_one_copy_per_source;
--   alter table public.carrier_products drop column copied_from_id;

alter table public.carrier_products
  add column if not exists copied_from_id uuid references public.carrier_products(id) on delete restrict;

alter table public.carrier_products
  drop constraint if exists carrier_products_copy_is_tenant_row,
  add constraint carrier_products_copy_is_tenant_row
    check (copied_from_id is null or tenant_id is not null) not valid;
alter table public.carrier_products validate constraint carrier_products_copy_is_tenant_row;

create unique index if not exists carrier_products_one_copy_per_source
  on public.carrier_products (tenant_id, copied_from_id) where copied_from_id is not null;

-- The source of a copy must be a platform row of the same carrier and product line.
create or replace function public.carrier_products_copy_source()
returns trigger language plpgsql as $function$
begin
  if new.copied_from_id is not null and not exists (
    select 1 from public.carrier_products s
     where s.id = new.copied_from_id and s.tenant_id is null
       and s.carrier_id = new.carrier_id and s.product_code = new.product_code) then
    raise exception 'CARRIER_PRODUCT_COPY_SOURCE: % is not a platform product of this carrier and product line', new.copied_from_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists carrier_products_copy_source on public.carrier_products;
create trigger carrier_products_copy_source before insert or update of copied_from_id, carrier_id, product_code on public.carrier_products
  for each row execute function public.carrier_products_copy_source();

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'carrier_products' and column_name = 'copied_from_id') then
    raise exception '20260926102410: carrier_products.copied_from_id is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_products_copy_is_tenant_row' and contype = 'c' and convalidated) then
    raise exception '20260926102410: a platform product can claim to be a copy';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'carrier_products_one_copy_per_source') then
    raise exception '20260926102410: an agency can copy the same platform product twice';
  end if;
end $$;
