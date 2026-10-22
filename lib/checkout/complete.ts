import "server-only";

// SA-5.2 · Turning a completed checkout into a working account.
//
// This is the fix for backlog #47. It is called from TWO places on purpose:
//
//   1. the return handler, so the product works the moment the customer lands — the ticket's
//      requirement that the entitlement is built before the redirect completes;
//   2. the membership.activated webhook, for the customer who pays and closes the tab.
//
// Either can arrive first, and either can be the only one that arrives. The SQL is idempotent on
// the tenant, so both running is harmless — which is the only way to be correct when you control
// neither the order nor whether both happen.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { trialDaysForPlan } from "./trialDays";
import { applyAutoOffer } from "@/lib/offers/service";
import { audit } from "@/lib/audit/log";
import type { BillingCycle } from "@/lib/money";

/** "no_payment": a checkout with CHECKOUT_PAYMENT_MODE=none (lib/checkout/noPayment.ts). */
export type CompletionSource = "return" | "webhook" | "no_payment";

export type Completion = {
  subscriptionId: string;
  created: boolean;
  status: string;
  planId: string;
};

/**
 * Creates the subscription and rebuilds the entitlement, if it does not already exist.
 *
 * Returns null when we cannot tell which plan the tenant bought — better to leave it for the other
 * caller (which may know) than to guess a plan and give someone the wrong product.
 */
export async function completeCheckout(
  tenantId: string,
  options: { membershipId?: string | null; planId?: string | null; billingCycle?: BillingCycle | null; source: CompletionSource },
): Promise<Completion | null> {
  const supabase = getSupabaseServiceClient();

  let planId = options.planId ?? null;
  let billingCycle = options.billingCycle ?? null;

  // Fall back to what the tenant chose at signup. The webhook carries the plan in metadata; the
  // return handler usually does not, and this is where it comes from.
  if (!planId || !billingCycle) {
    const { data: selection } = await supabase
      .from("signup_selections")
      .select("plan_id, billing_cycle")
      .eq("tenant_id", tenantId)
      .maybeSingle<{ plan_id: string; billing_cycle: BillingCycle }>();

    planId = planId ?? selection?.plan_id ?? null;
    billingCycle = billingCycle ?? selection?.billing_cycle ?? null;
  }

  if (!planId || !billingCycle) {
    console.warn(`[checkout] cannot complete for tenant ${tenantId} (${options.source}): no plan known`);
    return null;
  }

  const { data, error } = await supabase.rpc("create_subscription_from_checkout", {
    p_tenant_id: tenantId,
    p_plan_id: planId,
    p_billing_cycle: billingCycle,
    p_whop_membership_id: options.membershipId ?? null,
    // The plan version's own trial (plan_prices.trial_days), not a platform-wide 14 (audit 2026-10-15).
    p_trial_days: await trialDaysForPlan(planId),
  });

  if (error) throw new Error(`Could not create the subscription for ${tenantId}: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  // Immediately, not on a schedule: the acceptance criterion is that completing checkout lands the
  // user in the product with their plan's menu already correct, and the entitlement blob is what
  // the menu and every guard read.
  await rebuildEntitlement(tenantId, "subscription.plan_changed");

  if (row.created) {
    await supabase
      .from("checkout_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("status", "open");

    console.log(`[checkout] tenant ${tenantId}: subscription ${row.status} created via ${options.source}`);

    // SA-4.4: platform auto-offers reach self-serve signups too, not only admin-assigned
    // subscriptions (audit, 2026-10-15). Exactly once: only the caller whose call CREATED the
    // subscription runs it, and the SQL itself refuses a second coupon (already_has_coupon). A
    // failure never undoes the checkout — applyAutoOffer logs and returns null.
    const autoOfferId = await applyAutoOffer(row.subscription_id);
    if (autoOfferId) {
      await audit({
        actorId: null,
        actorType: "system",
        action: "offer.applied",
        targetType: "subscription",
        targetId: row.subscription_id,
        metadata: { offerId: autoOfferId, application: "auto", source: `checkout_${options.source}`, tenantId },
        request: new Request("https://internal.invalid/checkout/complete"),
      }).catch((error) => console.error(`[checkout] auto-offer ${autoOfferId} applied to ${row.subscription_id} but not audited`, error));
    }
  }

  return {
    subscriptionId: row.subscription_id,
    created: row.created,
    status: row.status,
    planId,
  };
}
