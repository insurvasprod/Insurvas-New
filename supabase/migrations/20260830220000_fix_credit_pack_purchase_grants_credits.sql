-- bugs_sa.md #11 (P1) · Buying a credit pack billed the customer and granted nothing.
--
-- purchaseCreditPack raised a custom invoice and returned. It never wrote a credit_grants row, and
-- nothing else did either — a repository-wide search found exactly one writer of that table, the
-- manual-grant path. So a customer bought "5,000 TCPA checks — $45", was invoiced $45, and their
-- balance did not move.
--
-- The fix is one function rather than two calls from TypeScript, because the invoice and the grant
-- have to be the same transaction. Two sequential writes would leave the same bug in a narrower
-- window: the invoice commits, the grant fails, and the customer is billed for nothing.

create or replace function public.purchase_credit_pack(
  p_pack_id         uuid,
  p_tenant_id       uuid,
  p_subscription_id uuid,
  p_quantity        integer,
  p_reason          text,
  p_created_by      uuid
)
returns table(
  invoice_id      uuid,
  number          text,
  total_cents     integer,
  grant_id        uuid,
  granted_qty     integer,
  meter_key       text,
  pack_name       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack     public.credit_packs%rowtype;
  v_amount   bigint;
  v_invoice  record;
  v_grant_id uuid;
  v_total    integer;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'quantity must be between 1 and 1000';
  end if;
  if length(coalesce(trim(p_reason), '')) < 5 then
    raise exception 'a reason of at least 5 characters is required';
  end if;

  select * into v_pack from public.credit_packs where id = p_pack_id;
  if not found then raise exception 'that credit pack does not exist'; end if;
  if not v_pack.is_active then raise exception 'that credit pack is no longer active'; end if;
  if v_pack.price_cents <= 0 then raise exception 'a free pack does not need an invoice'; end if;

  -- Checked in the same statement family that spends it, so a quantity that would overflow the
  -- invoice cannot be committed and then discovered.
  v_amount := v_pack.price_cents::bigint * p_quantity::bigint;
  if v_amount > 2000000000 then
    raise exception 'the requested pack quantity is too large for one invoice';
  end if;
  v_total := v_amount::integer;

  select * into v_invoice from public.create_custom_invoice(
    p_tenant_id,
    p_subscription_id,
    p_reason,
    null,
    p_created_by,
    jsonb_build_array(jsonb_build_object(
      'kind', 'addon',
      'label', v_pack.name || ' (' || (v_pack.quantity * p_quantity) || ' ' ||
               replace(v_pack.meter_key, '_', ' ') || ')',
      'quantity', p_quantity,
      'unit_cents', v_pack.price_cents,
      'amount_cents', v_total
    ))
  );

  -- The half that was missing. Same transaction as the invoice: either the customer is billed AND
  -- holds the credits, or neither happened.
  insert into public.credit_grants (tenant_id, meter_key, quantity, reason, granted_by)
  values (
    p_tenant_id,
    v_pack.meter_key,
    v_pack.quantity * p_quantity,
    'Credit pack purchased: ' || v_pack.name || ' (invoice ' || v_invoice.number || ') — ' || p_reason,
    p_created_by
  )
  returning id into v_grant_id;

  return query select
    v_invoice.invoice_id,
    v_invoice.number,
    v_total,
    v_grant_id,
    (v_pack.quantity * p_quantity)::integer,
    v_pack.meter_key::text,
    v_pack.name;
end;
$$;

revoke execute on function public.purchase_credit_pack(uuid, uuid, uuid, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.purchase_credit_pack(uuid, uuid, uuid, integer, text, uuid)
  to service_role;
