import "server-only";

// SA-3.6 · Creating and applying coupons.
//
// The Whop promo code is the real discount — it is what reduces the card charge. The local row is
// a mirror, so the admin UI, the invoice discount line and the audit trail have something to read,
// and so reconciliation can CHECK Whop rather than take its word.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { durationInMonths, type BillingCycle, type CouponDuration, type DiscountType } from "./discount";

export type CreateCouponInput = {
  code: string;
  discountType: DiscountType;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: CouponDuration;
  durationPeriods: number | null;
  billingCycle: BillingCycle;
  maxRedemptions: number | null;
  expiresAt: string | null;
  createdBy: string;
};

export async function createCoupon(input: CreateCouponInput): Promise<{ id: string; whopPromoCodeId: string }> {
  const companyId = process.env.WHOP_ACCOUNT_ID;
  if (!companyId) throw new Error("WHOP_ACCOUNT_ID is not set");

  const provider = buildProvider("whop");
  if (!(provider instanceof WhopProvider)) throw new Error("Coupons require the Whop provider");

  // Periods to months, against the cycle this coupon is for. Passing the period count straight
  // through would make a 3-period coupon on a yearly plan discount only the first invoice.
  const months = durationInMonths(input.duration, input.durationPeriods, input.billingCycle);

  // Whop takes decimal currency for a flat discount and a plain number for a percentage.
  const amountOff =
    input.discountType === "percent" ? input.percentOff! : (input.amountOffCents ?? 0) / 100;

  // Whop FIRST. If it fails there is no discount, and a local row would be a promise we cannot
  // keep — the customer would be charged full price with our books saying otherwise.
  const promo = await provider.createPromoCode({
    code: input.code,
    companyId,
    discountType: input.discountType,
    amountOff,
    durationMonths: months,
    expiresAt: input.expiresAt,
    maxRedemptions: input.maxRedemptions,
  });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      code: input.code,
      discount_type: input.discountType,
      percent_off: input.percentOff,
      amount_off_cents: input.amountOffCents,
      duration: input.duration,
      duration_periods: input.durationPeriods,
      billing_cycle: input.billingCycle,
      max_redemptions: input.maxRedemptions,
      expires_at: input.expiresAt,
      whop_promo_code_id: promo.promoCodeId,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error) {
    // The promo exists at Whop but we could not record it. Loud, because the discount is live and
    // invisible to us — a customer could redeem a code our books have never heard of.
    console.error(
      `[coupons] Whop promo ${promo.promoCodeId} (${input.code}) was created but NOT recorded locally: ${error.message}`,
    );
    throw new Error(`Coupon created at the provider but not recorded: ${error.message}`);
  }

  return { id: data.id, whopPromoCodeId: promo.promoCodeId };
}

export type ApplyResult = "ok" | "not_found" | "inactive" | "expired" | "exhausted" | "already_has_coupon";

const APPLY_MESSAGES: Record<Exclude<ApplyResult, "ok">, string> = {
  not_found: "That coupon does not exist.",
  inactive: "That coupon has been deactivated.",
  expired: "That coupon has expired.",
  exhausted: "That coupon has reached its redemption limit.",
  already_has_coupon: "This subscription already has a coupon. Remove it before applying another.",
};

export function applyFailureMessage(result: Exclude<ApplyResult, "ok">): string {
  return APPLY_MESSAGES[result];
}

export async function applyCoupon(
  subscriptionId: string,
  couponId: string,
  appliedBy: string | null,
): Promise<ApplyResult> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: subscriptionId,
    p_coupon_id: couponId,
    p_applied_by: appliedBy,
  });

  if (error) throw new Error(`Could not apply the coupon: ${error.message}`);
  return (data as ApplyResult) ?? "not_found";
}

export async function removeCoupon(subscriptionId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("subscription_coupons")
    .update({ is_active: false, removed_at: new Date().toISOString() })
    .eq("subscription_id", subscriptionId)
    .eq("is_active", true)
    .select("id");

  // The redemption is deliberately NOT given back. It was used; releasing it would let one
  // customer consume a limited coupon repeatedly by applying and removing it.
  return (data ?? []).length > 0;
}
