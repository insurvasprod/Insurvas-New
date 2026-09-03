-- SA-3.6 / backlog #89: invoice creation and coupon consumption must share one transaction.
--
-- The existing invoice RPC remains the canonical invoice builder. This service-role-only wrapper
-- calls it and consumes the coupon period in the same PostgreSQL transaction, so an error in
-- either operation rolls back both effects. Redeliveries return created=false and never consume
-- another period.

create or replace function public.create_invoice_for_payment_with_coupon(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_provider_total_cents integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_paid_at timestamptz,
  p_lines jsonb,
  p_consume_coupon boolean
)
returns table(invoice_id uuid, number text, created boolean, reconciliation text)
language plpgsql
set search_path to ''
as $function$
declare
  v_invoice record;
begin
  select * into v_invoice
    from public.create_invoice_for_payment(
      p_tenant_id,
      p_subscription_id,
      p_provider,
      p_provider_payment_id,
      p_provider_total_cents,
      p_period_start,
      p_period_end,
      p_paid_at,
      p_lines
    );

  if v_invoice.created and p_consume_coupon and p_subscription_id is not null then
    perform public.consume_coupon_period(p_subscription_id);
  end if;

  return query select v_invoice.invoice_id, v_invoice.number, v_invoice.created, v_invoice.reconciliation;
end;
$function$;

revoke all on function public.create_invoice_for_payment_with_coupon(
  uuid, uuid, text, text, integer, timestamptz, timestamptz, timestamptz, jsonb, boolean
) from public, anon, authenticated, tenant_app;
grant execute on function public.create_invoice_for_payment_with_coupon(
  uuid, uuid, text, text, integer, timestamptz, timestamptz, timestamptz, jsonb, boolean
) to service_role;
