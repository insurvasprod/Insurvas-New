-- SA-4.4 repair: a plan/cycle-specific campaign must win over an older broad campaign.
-- This preserves deterministic creation order among offers with the same specificity while
-- preventing a global launch offer from shadowing a targeted campaign forever.

create or replace function public.apply_auto_offer_to_subscription(p_subscription_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  subscription_row record;
  plan_row record;
  offer_row record;
  prior_subscription boolean;
  apply_result text;
begin
  select s.* into subscription_row from public.subscriptions s where s.id = p_subscription_id;
  if not found then return null; end if;
  select p.* into plan_row from public.plans p where p.id = subscription_row.plan_id;
  if not found then return null; end if;
  select exists (
    select 1 from public.subscriptions previous
     where previous.tenant_id = subscription_row.tenant_id
       and previous.id <> subscription_row.id
       and previous.created_at < subscription_row.created_at
  ) into prior_subscription;

  for offer_row in
    select o.*, c.id as linked_coupon_id, c.max_redemptions as coupon_max_redemptions,
           c.redeemed_count as coupon_redeemed_count
      from public.offers o
      join public.coupons c on c.id = o.coupon_id
     where o.auto_apply and o.is_active
       and (o.starts_at is null or now() >= o.starts_at)
       and (o.ends_at is null or now() < o.ends_at)
       and (o.max_redemptions is null or o.redeemed_count < o.max_redemptions)
       and c.is_active
     order by
       (cardinality(o.eligible_plan_ids) > 0) desc,
       (cardinality(o.eligible_plan_types) > 0) desc,
       (cardinality(o.eligible_cycles) > 0) desc,
       o.created_at asc
  loop
    if cardinality(offer_row.eligible_plan_types) > 0
       and not (plan_row.plan_type = any(offer_row.eligible_plan_types)) then continue; end if;
    if cardinality(offer_row.eligible_plan_ids) > 0
       and not (subscription_row.plan_id = any(offer_row.eligible_plan_ids)) then continue; end if;
    if cardinality(offer_row.eligible_cycles) > 0
       and not (subscription_row.billing_cycle = any(offer_row.eligible_cycles)) then continue; end if;
    if offer_row.new_customers_only and prior_subscription then continue; end if;
    if offer_row.existing_customers_only and not prior_subscription then continue; end if;

    apply_result := public.admin_apply_coupon(p_subscription_id, offer_row.linked_coupon_id, null);
    if apply_result = 'ok' then return offer_row.id; end if;
    if apply_result = 'already_has_coupon' then return null; end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.apply_auto_offer_to_subscription(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.apply_auto_offer_to_subscription(uuid) to service_role;
