import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { applyCoupon, type ApplyResult } from "@/lib/coupons/service";
import { createCoupon } from "@/lib/coupons/service";
import { parseDollarsToCents } from "@/lib/money";
import type { BillingCycle, OfferFormInput, OfferRow, PlanType } from "./constants";
import { couponCapForOfferCap, manualOfferWarning, offerApplyRefusal, offerEligibilityFailures, type OfferCustomerContext } from "./rules";
import { fetchOffer, fetchOfferForApplication } from "./queries";
import type { Database } from "@/lib/supabase/database.types";

export type CreateOfferInput = OfferFormInput & { createdBy: string };
export type UpdateOfferInput = Partial<OfferFormInput>;

function providerCycle(input: OfferFormInput): BillingCycle {
  // Whop needs one billing cycle to translate a promo duration. The local coupon still consumes
  // exactly the configured number of invoices; eligibility may be broader than this provider hint.
  return input.eligible_cycles[0] ?? "monthly";
}

function generatedOfferCode(): string {
  return `OFR${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createOffer(input: CreateOfferInput): Promise<OfferRow> {
  const amountOffCents = input.discount_type === "fixed" && input.amount_off
    ? parseDollarsToCents(input.amount_off)
    : null;
  if (input.discount_type === "fixed" && (!amountOffCents || amountOffCents <= 0)) {
    throw new Error("Enter a fixed amount like 25.00");
  }

  const coupon = await createCoupon({
    code: generatedOfferCode(),
    discountType: input.discount_type,
    percentOff: input.discount_type === "percent" ? (input.percent_off ?? null) : null,
    amountOffCents,
    duration: input.duration,
    durationPeriods: input.duration === "n_periods" ? (input.duration_periods ?? null) : null,
    billingCycle: providerCycle(input),
    maxRedemptions: input.max_redemptions ?? null,
    // The offer window controls auto-application. The linked coupon must not expire because an
    // already-applied offer continues to be honoured after the campaign ends.
    expiresAt: null,
    createdBy: input.createdBy,
  });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("offers")
    .insert({
      name: input.name,
      coupon_id: coupon.id,
      starts_at: input.starts_at ?? null,
      ends_at: input.ends_at ?? null,
      max_redemptions: input.max_redemptions ?? null,
      auto_apply: input.auto_apply,
      eligible_plan_types: input.eligible_plan_types,
      eligible_plan_ids: input.eligible_plan_ids,
      new_customers_only: input.new_customers_only,
      existing_customers_only: input.existing_customers_only,
      eligible_cycles: input.eligible_cycles,
      created_by: input.createdBy,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Could not record offer: ${error.message}`);

  const created = await fetchOffer(data.id);
  if (!created) throw new Error("Offer was created but could not be read back");
  return created;
}

export async function updateOffer(id: string, input: UpdateOfferInput): Promise<OfferRow> {
  const current = await fetchOffer(id);
  if (!current || !current.coupon) throw new Error("Offer not found");

  if (
    input.discount_type !== undefined ||
    input.percent_off !== undefined ||
    input.amount_off !== undefined ||
    input.duration !== undefined ||
    input.duration_periods !== undefined
  ) {
    throw new Error("Discount terms cannot be edited after an offer is created; create a new offer instead.");
  }

  // The linked Whop promo and local coupon were created with the same cap. We can safely lower
  // the campaign cap, but cannot raise/remove the provider cap without a new promo code.
  if (
    input.max_redemptions !== undefined &&
    current.coupon.max_redemptions !== null &&
    (input.max_redemptions === null || input.max_redemptions > current.coupon.max_redemptions)
  ) {
    throw new Error("Redemption capacity cannot be increased after creation; create a new offer instead.");
  }

  const patch: Database["public"]["Tables"]["offers"]["Update"] = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.starts_at !== undefined) patch.starts_at = input.starts_at;
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at;
  if (input.max_redemptions !== undefined) patch.max_redemptions = input.max_redemptions;
  if (input.auto_apply !== undefined) patch.auto_apply = input.auto_apply;
  if (input.eligible_plan_types !== undefined) patch.eligible_plan_types = input.eligible_plan_types;
  if (input.eligible_plan_ids !== undefined) patch.eligible_plan_ids = input.eligible_plan_ids;
  if (input.new_customers_only !== undefined) patch.new_customers_only = input.new_customers_only;
  if (input.existing_customers_only !== undefined) patch.existing_customers_only = input.existing_customers_only;
  if (input.eligible_cycles !== undefined) patch.eligible_cycles = input.eligible_cycles;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const supabase = getSupabaseServiceClient();
  // Lowering the campaign cap lowers the linked coupon's cap too (audit, 2026-10-15): the coupon is
  // what admin_apply_coupon counts, so a cap kept only on the offer was a cap in name. The coupon is
  // written first; if the offer update then fails, the tighter coupon cap is the safe leftover. The
  // Whop promo code keeps the cap it was created with — Whop is not called from here.
  const couponCap = input.max_redemptions !== undefined
    ? couponCapForOfferCap(input.max_redemptions, current.coupon.max_redemptions)
    : undefined;
  if (couponCap !== undefined) {
    const { error: couponError } = await supabase.from("coupons").update({ max_redemptions: couponCap } as never).eq("id", current.coupon_id);
    if (couponError) throw new Error(`Could not lower the offer's coupon cap: ${couponError.message}`);
  }
  const { error } = await supabase.from("offers").update(patch).eq("id", id);
  if (error) throw new Error(`Could not update offer: ${error.message}`);
  const updated = await fetchOffer(id);
  if (!updated) throw new Error("Offer was updated but could not be read back");
  return updated;
}

type ApplicationContext = OfferCustomerContext & { tenantId: string; subscriptionId: string };

async function applicationContext(subscriptionId: string): Promise<ApplicationContext | null> {
  const supabase = getSupabaseServiceClient();
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, plan_id, billing_cycle, created_at")
    .eq("id", subscriptionId)
    .maybeSingle<{ id: string; tenant_id: string; plan_id: string; billing_cycle: BillingCycle; created_at: string }>();
  if (error || !subscription) return null;

  const [{ data: plan }, { data: previous }] = await Promise.all([
    supabase.from("plans").select("plan_type").eq("id", subscription.plan_id).maybeSingle<{ plan_type: PlanType }>(),
    supabase
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", subscription.tenant_id)
      .neq("id", subscription.id)
      .lt("created_at", subscription.created_at)
      .limit(1),
  ]);
  if (!plan) return null;

  return {
    tenantId: subscription.tenant_id,
    subscriptionId: subscription.id,
    planType: plan.plan_type,
    planId: subscription.plan_id,
    billingCycle: subscription.billing_cycle,
    isNewCustomer: (previous ?? []).length === 0,
  };
}

export type ManualApplyResult =
  | { status: "confirmation_required"; warning: string }
  | { status: "applied" }
  | { status: "rejected"; result: Exclude<ApplyResult, "ok">; message?: string };

export async function applyOfferManually(
  offerId: string,
  subscriptionId: string,
  appliedBy: string,
  confirmed: boolean,
): Promise<ManualApplyResult> {
  const [offer, context] = await Promise.all([fetchOfferForApplication(offerId), applicationContext(subscriptionId)]);
  if (!offer || !context) return { status: "rejected", result: "not_found" };
  // The offer's own active flag and cap, before anything else: a paused or used-up offer is refused
  // whatever the admin confirms (audit, 2026-10-15).
  const refusal = offerApplyRefusal(offer);
  if (refusal) return { status: "rejected", result: refusal.result, message: refusal.message };

  const warning = manualOfferWarning(
    {
      eligiblePlanTypes: offer.eligible_plan_types,
      eligiblePlanIds: offer.eligible_plan_ids,
      eligibleCycles: offer.eligible_cycles,
      newCustomersOnly: offer.new_customers_only,
      existingCustomersOnly: offer.existing_customers_only,
      startsAt: offer.starts_at,
      endsAt: offer.ends_at,
    },
    context,
  );
  if (warning && !confirmed) return { status: "confirmation_required", warning };

  const result = await applyOfferWithinCap(offerId, subscriptionId, offer.coupon_id, appliedBy);
  if (result === "ok") return { status: "applied" };
  // Refused under the lock (a concurrent apply took the last redemption, or it was paused meanwhile).
  const late = result === "inactive" || result === "exhausted" ? offerApplyRefusal(await fetchOfferForApplication(offerId) ?? offer) : null;
  return { status: "rejected", result, ...(late ? { message: late.message } : {}) };
}

/**
 * admin_apply_offer (20261015610100) re-checks the offer's flag and cap with the offer row locked,
 * then applies its coupon in the same transaction, so two admins cannot both take the last
 * redemption. Before that migration is live, fall back to the coupon apply; the check above still
 * ran, only without the lock.
 */
async function applyOfferWithinCap(offerId: string, subscriptionId: string, couponId: string, appliedBy: string): Promise<ApplyResult> {
  const { data, error } = await getSupabaseServiceClient().rpc("admin_apply_offer" as never, {
    p_offer_id: offerId,
    p_subscription_id: subscriptionId,
    p_applied_by: appliedBy,
  } as never) as unknown as { data: string | null; error: { code?: string; message: string } | null };
  if (error && (error.code === "PGRST202" || error.code === "42883")) return applyCoupon(subscriptionId, couponId, appliedBy);
  if (error) throw new Error(`Could not apply the offer: ${error.message}`);
  return (data as ApplyResult | null) ?? "not_found";
}

export async function applyAutoOffer(subscriptionId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("apply_auto_offer_to_subscription", {
    p_subscription_id: subscriptionId,
  });
  if (error) {
    // A missing migration must not roll back the subscription assignment. The deployment check
    // catches it, while existing billing remains available without auto-apply.
    console.error("[offers] auto-apply failed", error);
    return null;
  }
  return data;
}

export function offerAutoEligibilityFailures(offer: OfferRow, context: OfferCustomerContext): string[] {
  return offerEligibilityFailures(
    {
      startsAt: offer.starts_at,
      endsAt: offer.ends_at,
      eligiblePlanTypes: offer.eligible_plan_types,
      eligiblePlanIds: offer.eligible_plan_ids,
      newCustomersOnly: offer.new_customers_only,
      existingCustomersOnly: offer.existing_customers_only,
      eligibleCycles: offer.eligible_cycles,
    },
    context,
  );
}
