-- LA-1.3 compatibility repair: the live organizations-era partner_products table
-- also needs its organization and lifecycle columns populated. Without these
-- values an approval is invisible to the partner portal (organization_id NULL,
-- status pending), even though the tenant/product checks pass.

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
  select * into v_partner
    from public.partners
   where id = p_partner_id and tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_partner.status = 'offboarded' then raise exception 'partner_offboarded'; end if;

  select * into v_product from public.products where code = btrim(p_product_code);
  if not found then raise exception 'product_not_found'; end if;
  if not v_product.is_active then raise exception 'product_archived'; end if;

  select tp.is_enabled into v_enabled
    from public.tenant_products tp
   where tp.tenant_id = p_tenant_id and tp.product_code = v_product.code;
  if coalesce(v_enabled, false) = false and p_approved then
    raise exception 'product_not_enabled';
  end if;

  if p_approved then
    insert into public.partner_products (
      organization_id, partner_id, product_code, name, product_line,
      status, effective_from, approved_at, approved_by, created_by
    ) values (
      v_partner.organization_id,
      p_partner_id,
      v_product.code,
      coalesce(nullif(btrim(v_product.name), ''), v_product.code),
      v_product.code,
      'approved',
      current_date,
      now(),
      p_approved_by,
      p_approved_by
    )
    on conflict (partner_id, product_code) do update
      set organization_id = excluded.organization_id,
          name = excluded.name,
          product_line = excluded.product_line,
          status = 'approved',
          effective_from = least(public.partner_products.effective_from, excluded.effective_from),
          effective_to = null,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by,
          updated_at = now();
    return true;
  end if;

  delete from public.partner_products
   where partner_id = p_partner_id and product_code = v_product.code;
  return false;
end;
$function$;

revoke all on function public.set_partner_product_approval(uuid, uuid, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_partner_product_approval(uuid, uuid, text, boolean, uuid)
  to service_role;
