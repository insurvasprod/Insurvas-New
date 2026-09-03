-- SA-3.6 / backlog #91: coupon plan and billing-cycle restrictions belong in the RPC.
--
-- The admin picker is only a convenience. This function is also reachable from other server
-- paths, so an incompatible coupon must be refused even when the request bypasses the UI.

create or replace function public.admin_apply_coupon(p_subscription_id uuid, p_coupon_id uuid, p_applied_by uuid)
returns text
language plpgsql
set search_path to ''
as $function$
declare
  v_coupon public.coupons%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_periods integer;
begin
  -- Lock both records while eligibility and the redemption cap are decided. A plan change cannot
  -- race this check and make an otherwise ineligible coupon active after validation.
  select * into v_subscription
    from public.subscriptions
   where id = p_subscription_id
   for update;
  if not found then return 'not_found'; end if;

  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found then return 'not_found'; end if;
  if not v_coupon.is_active then return 'inactive'; end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then return 'expired'; end if;
  if v_coupon.max_redemptions is not null and v_coupon.redeemed_count >= v_coupon.max_redemptions then
    return 'exhausted';
  end if;

  if v_coupon.restricted_to_plan_ids is not null
     and cardinality(v_coupon.restricted_to_plan_ids) > 0
     and not (v_subscription.plan_id = any(v_coupon.restricted_to_plan_ids)) then
    return 'plan_restricted';
  end if;

  if v_coupon.billing_cycle is not null and v_subscription.billing_cycle <> v_coupon.billing_cycle then
    return 'billing_cycle_restricted';
  end if;

  -- "One at a time, reject the second" — checked here as well as by the unique index, so the
  -- caller gets a named reason rather than a constraint violation.
  if exists (
    select 1 from public.subscription_coupons
     where subscription_id = p_subscription_id and is_active
  ) then
    return 'already_has_coupon';
  end if;

  v_periods := case
    when v_coupon.duration = 'forever' then null
    when v_coupon.duration = 'once' then 1
    else v_coupon.duration_periods
  end;

  insert into public.subscription_coupons (subscription_id, coupon_id, applied_by, periods_remaining)
  values (p_subscription_id, p_coupon_id, p_applied_by, v_periods);

  update public.coupons set redeemed_count = redeemed_count + 1 where id = p_coupon_id;

  return 'ok';
end;
$function$;

revoke execute on function public.admin_apply_coupon(uuid, uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_apply_coupon(uuid, uuid, uuid)
  to service_role;
