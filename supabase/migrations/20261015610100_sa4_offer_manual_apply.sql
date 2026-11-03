-- SA-4.4 audit fix (2026-10-15): a manual offer apply honours the offer's own active flag and cap.
--
-- apply_auto_offer_to_subscription already skips an inactive offer and one past offers.max_redemptions.
-- The manual path (lib/offers/service.ts applyOfferManually) went straight to admin_apply_coupon,
-- which checks only the linked coupon — so a paused offer could still be applied by hand, and an
-- offer whose campaign cap had been lowered below the coupon's kept redeeming up to the coupon's.
--
-- admin_apply_offer locks the offer row, refuses 'inactive' / 'exhausted' in the words
-- admin_apply_coupon already uses, then applies the coupon in the same transaction. The lock is what
-- stops two admins from both taking the last redemption: offers.redeemed_count is bumped by the
-- subscription_coupons insert trigger (increment_offer_redemption) inside admin_apply_coupon, before
-- this transaction releases the offer row.
--
-- Same security as admin_apply_coupon (invoker, empty search_path), executable by service_role only.
-- The app falls back to the old path while this is not live (PGRST202 / 42883).

create or replace function public.admin_apply_offer(p_offer_id uuid, p_subscription_id uuid, p_applied_by uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_offer public.offers%rowtype;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then return 'not_found'; end if;
  if not v_offer.is_active then return 'inactive'; end if;
  if v_offer.max_redemptions is not null and v_offer.redeemed_count >= v_offer.max_redemptions then
    return 'exhausted';
  end if;
  return public.admin_apply_coupon(p_subscription_id, v_offer.coupon_id, p_applied_by);
end;
$$;

revoke all on function public.admin_apply_offer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_apply_offer(uuid, uuid, uuid) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.admin_apply_offer(uuid, uuid, uuid)') is null then
    raise exception 'admin_apply_offer is missing';
  end if;
  if to_regprocedure('public.admin_apply_coupon(uuid, uuid, uuid)') is null then
    raise exception 'admin_apply_offer needs admin_apply_coupon(uuid, uuid, uuid)';
  end if;
  if has_function_privilege('anon', 'public.admin_apply_offer(uuid, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_apply_offer(uuid, uuid, uuid)', 'execute') then
    raise exception 'admin_apply_offer must not be callable by anon or authenticated';
  end if;
end;
$$;
