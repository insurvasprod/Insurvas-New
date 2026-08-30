import "server-only";

// SA-3.1 · The seam SA-5.2 will call.
//
// Deliberately server-only and UI-free: this returns a URL. How a customer reaches it — a button,
// an email, an embedded element — is SA-5.2's decision, not this ticket's.

import { getPaymentProviderForTenant } from "./registry";
import { ensureWhopPlan } from "./whop/planMapping";
import type { BillingCycle } from "@/lib/money";

export type TenantCheckout = {
  url: string;
  sessionId: string;
  providerPlanId: string;
  /**
   * True when our price for this plan version no longer matches what the provider was told.
   * Should be impossible — a price change is supposed to create a new version — so it is surfaced
   * rather than silently selling at the stale price.
   */
  priceDrifted: boolean;
};

export async function createTenantCheckout(
  tenantId: string,
  planId: string,
  billingCycle: BillingCycle,
): Promise<TenantCheckout> {
  // Creates the Whop plan on first sale of this (version, cycle) and reuses it forever after.
  const mapping = await ensureWhopPlan(planId, billingCycle);

  const { provider } = await getPaymentProviderForTenant(tenantId);

  const session = await provider.createCheckoutSession({
    providerPlanId: mapping.whopPlanId,
    tenantId,
    // Read back off the webhook to attribute the payment. The plan carries its own metadata for
    // renewals, which arrive without a checkout session.
    metadata: { insurvas_plan_id: planId, insurvas_billing_cycle: billingCycle },
  });

  if (mapping.priceDrifted) {
    console.warn(
      `[checkout] plan ${planId} (${billingCycle}) is priced differently to its Whop plan ${mapping.whopPlanId}. ` +
        "A price change should have created a new plan version.",
    );
  }

  return {
    url: session.url,
    sessionId: session.id,
    providerPlanId: mapping.whopPlanId,
    priceDrifted: mapping.priceDrifted,
  };
}
