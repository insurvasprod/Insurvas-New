import "server-only";

// SA-5.2 · Opening a hosted checkout.
//
// The card is entered on Whop's page and never reaches us — no card number, CVV or expiry touches
// our servers, our logs or our database. That is not a preference: handling raw card data would
// pull a compliance burden onto this team that would swallow the roadmap.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { ensureWhopPlan } from "@/lib/payments/whop/planMapping";
import { couponRejectionReason } from "@/lib/coupons/discount";
import { availableBillingCycles } from "@/lib/money";
import type { PlanPrices } from "@/lib/money";
import { TRIAL_DAYS, checkoutReturnUrl } from "./constants";
import type { BillingCycle } from "@/lib/money";

export class CheckoutError extends Error {}

export type StartedCheckout = {
  checkoutUrl: string;
  sessionId: string;
  planName: string;
  trialDays: number;
};

export type CouponCheck = { ok: true; couponId: string; code: string } | { ok: false; reason: string };

/**
 * Validates a coupon BEFORE checkout opens, against our mirror of Whop's promo codes.
 *
 * The ticket's criterion is that an invalid code is rejected before the customer is sent to a
 * hosted page — discovering it is dead only after arriving there is the experience it forbids.
 * Whop still enforces the real rules at checkout; this is the fast, local half.
 */
export async function checkCoupon(code: string, planId: string): Promise<CouponCheck> {
  const supabase = getSupabaseServiceClient();
  const { data: coupon } = await supabase
    .from("coupons")
    .select("id, code, is_active, expires_at, max_redemptions, redeemed_count, restricted_to_plan_ids")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle<{
      id: string;
      code: string;
      is_active: boolean;
      expires_at: string | null;
      max_redemptions: number | null;
      redeemed_count: number;
      restricted_to_plan_ids: string[] | null;
    }>();

  if (!coupon) return { ok: false, reason: "That code was not recognised." };

  const rejection = couponRejectionReason({
    isActive: coupon.is_active,
    expiresAt: coupon.expires_at,
    maxRedemptions: coupon.max_redemptions,
    redeemedCount: coupon.redeemed_count,
  });
  if (rejection) return { ok: false, reason: rejection };

  if (coupon.restricted_to_plan_ids?.length && !coupon.restricted_to_plan_ids.includes(planId)) {
    return { ok: false, reason: "That code does not apply to the plan you have chosen." };
  }

  return { ok: true, couponId: coupon.id, code: coupon.code };
}

/**
 * Opens a checkout for the plan this tenant chose at signup.
 *
 * Reuses an already-open session rather than opening another: a customer who abandons checkout and
 * comes back should land on the same page, which is what "recoverable by returning, not a broken
 * half-account" means.
 */
export async function startCheckout(tenantId: string, couponCode?: string): Promise<StartedCheckout> {
  const supabase = getSupabaseServiceClient();

  const { data: selection } = await supabase
    .from("signup_selections")
    .select("plan_id, billing_cycle")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ plan_id: string; billing_cycle: BillingCycle }>();

  if (!selection) throw new CheckoutError("No plan has been selected for this account.");

  const { data: plan } = await supabase
    .from("plans")
    .select("id, name, code, version, is_archived")
    .eq("id", selection.plan_id)
    .maybeSingle<{ id: string; name: string; code: string; version: number; is_archived: boolean }>();

  if (!plan || plan.is_archived) throw new CheckoutError("That plan is no longer available.");

  // The same helper the pricing screens use, passed the raw row: a null cycle price means that
  // cycle is not offered, and zero is a price (a free plan is still buyable). Backlog #21 asked
  // SA-5.2 to call this rather than re-derive the rule, so it does.
  const { data: prices } = await supabase
    .from("plan_prices")
    .select("*")
    .eq("plan_id", plan.id)
    .maybeSingle<PlanPrices>();

  const cycles = availableBillingCycles(prices);
  if (!cycles.includes(selection.billing_cycle)) {
    throw new CheckoutError(`${plan.name} is not sold on a ${selection.billing_cycle} cycle.`);
  }

  let couponId: string | null = null;
  if (couponCode?.trim()) {
    const check = await checkCoupon(couponCode, plan.id);
    if (!check.ok) throw new CheckoutError(check.reason);
    couponId = check.couponId;
  }

  // An open session is reused so returning to checkout does not strand the first one.
  const { data: open } = await supabase
    .from("checkout_sessions")
    .select("id, checkout_url, provider_config_id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .maybeSingle<{ id: string; checkout_url: string; provider_config_id: string }>();

  if (open && !couponId) {
    return { checkoutUrl: open.checkout_url, sessionId: open.id, planName: plan.name, trialDays: TRIAL_DAYS };
  }

  // Creates the Whop plan on first sale of this (version, cycle) and reuses it forever after. The
  // trial lives on that plan.
  const mapping = await ensureWhopPlan(plan.id, selection.billing_cycle);

  const provider = buildProvider("whop");
  if (!(provider instanceof WhopProvider)) throw new CheckoutError("Checkout requires the Whop provider.");

  const session = await provider.createCheckoutSession({
    providerPlanId: mapping.whopPlanId,
    tenantId,
    metadata: {
      insurvas_plan_id: plan.id,
      insurvas_billing_cycle: selection.billing_cycle,
      ...(couponId ? { insurvas_coupon_id: couponId } : {}),
    },
    returnUrl: checkoutReturnUrl() ?? undefined,
  });

  const { data: row, error } = await supabase
    .from("checkout_sessions")
    .insert({
      tenant_id: tenantId,
      plan_id: plan.id,
      billing_cycle: selection.billing_cycle,
      coupon_id: couponId,
      provider: "whop",
      provider_config_id: session.id,
      checkout_url: session.url,
    })
    .select("id")
    .single();

  if (error) throw new CheckoutError(`Could not record the checkout session: ${error.message}`);

  // Abandoning leaves the tenant here rather than in a broken half-state, and returning resumes.
  await supabase.from("tenants").update({ onboarding_state: "awaiting_payment" }).eq("id", tenantId);

  return { checkoutUrl: session.url, sessionId: row.id, planName: plan.name, trialDays: TRIAL_DAYS };
}
