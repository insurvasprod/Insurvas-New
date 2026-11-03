-- Populate the columns the live partner_products table requires.
--
-- `partner_products` here is the organizations-era table: an effective-dated product agreement with
-- `name` and `product_line` NOT NULL, keyed UNIQUE (partner_id, name, effective_from). The tenant
-- plane models the same idea far more simply, as an approval row keyed on (partner_id,
-- product_code), and set_partner_product_approval inserts only the four columns LA-1.3 declares. So
-- every approval fails:
--
--   23502 null value in column "name" of relation "partner_products"
--
-- costing LA-1.3 its five approval criteria.
--
-- Filling those columns rather than making them nullable. They are the other product's required
-- fields and a null there would leave rows its own screens cannot render; a name and a product line
-- derived from the catalog entry are both correct and readable from either side. `products.name` is
-- the human label ("Term Life"), and product_line takes the code, which is the value the
-- organizations-era rows carry.
--
-- Everything else about the function is unchanged, including the offboarded and not-enabled guards
-- and the delete-on-unapprove.

create or replace function public.set_partner_product_approval(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_product_code text,
  p_approved boolean,
  p_approved_by uuid
)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare
  v_partner public.partners;
  v_product public.products;
  v_enabled boolean;
begin
  select * into v_partner from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_partner.status = 'offboarded' then raise exception 'partner_offboarded'; end if;

  select * into v_product from public.products where code = btrim(p_product_code);
  if not found then raise exception 'product_not_found'; end if;
  if not v_product.is_active then raise exception 'product_archived'; end if;

  select tp.is_enabled into v_enabled
  from public.tenant_products tp
  where tp.tenant_id = p_tenant_id and tp.product_code = v_product.code;
  if coalesce(v_enabled, false) = false and p_approved then raise exception 'product_not_enabled'; end if;

  if p_approved then
    -- name and product_line are required by the organizations-era shape of this table.
    insert into public.partner_products (partner_id, product_code, name, product_line, approved_at, approved_by)
    values (p_partner_id, v_product.code, coalesce(nullif(btrim(v_product.name), ''), v_product.code), v_product.code, now(), p_approved_by)
    on conflict (partner_id, product_code) do update
      set approved_at = now(), approved_by = excluded.approved_by;
    return true;
  end if;

  delete from public.partner_products
  where partner_id = p_partner_id and product_code = v_product.code;
  return false;
end;
$function$;
