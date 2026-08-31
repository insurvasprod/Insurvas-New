import "server-only";

// bugs_sa.md #1 (P0) · Asking the provider whether a checkout really completed.
//
// The return URL is a plain GET that any signed-in user can navigate to. Nothing in it is secret
// and nothing about arriving there proves a payment happened, so it cannot be the thing that
// decides whether someone gets the product. This is the check that decides instead.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import type { BillingCycle } from "@/lib/money";

export type CheckoutVerification =
  | { confirmed: true; membershipId: string }
  | { confirmed: false; reason: string };

/**
 * Confirms with Whop that this tenant holds a membership for the plan they were checking out.
 *
 * FAILS CLOSED in every direction. An unmapped plan, a provider that is down, a malformed answer —
 * all return `confirmed: false`, because the cost of being wrong is asymmetric: a false "no" makes
 * a paying customer wait a few seconds for the webhook, while a false "yes" gives away the product.
 *
 * The webhook is why waiting is safe. It is a second, independent, signed path to the same
 * completion, so a customer this refuses is not stranded — they are completed a moment later by an
 * event we can actually verify.
 */
export async function verifyCheckoutWithProvider(input: {
  tenantId: string;
  planId: string;
  billingCycle: BillingCycle;
}): Promise<CheckoutVerification> {
  const supabase = getSupabaseServiceClient();

  // Read the mapping rather than ensureWhopPlan(): this path must never CREATE a plan at the
  // provider. If no mapping exists then no checkout was ever opened for it, which is itself the
  // answer.
  const { data: mapping } = await supabase
    .from("whop_plans")
    .select("whop_plan_id")
    .eq("plan_id", input.planId)
    .eq("billing_cycle", input.billingCycle)
    .maybeSingle<{ whop_plan_id: string }>();

  if (!mapping?.whop_plan_id) {
    return { confirmed: false, reason: "no provider plan is mapped for this plan and cycle" };
  }

  let provider;
  try {
    provider = buildProvider("whop");
  } catch (error) {
    return { confirmed: false, reason: `provider unavailable: ${asMessage(error)}` };
  }

  if (!(provider instanceof WhopProvider)) {
    return { confirmed: false, reason: "the configured provider cannot confirm memberships" };
  }

  try {
    const membership = await provider.findMembershipForTenant(mapping.whop_plan_id, input.tenantId);

    if (!membership) {
      return { confirmed: false, reason: "the provider holds no membership for this tenant" };
    }

    return { confirmed: true, membershipId: membership.id };
  } catch (error) {
    // A provider outage must not become free access. Logged by the caller; the webhook still
    // completes this customer when Whop recovers.
    return { confirmed: false, reason: `provider lookup failed: ${asMessage(error)}` };
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
