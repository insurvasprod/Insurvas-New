import "server-only";

// SA-3.7 · Manual billing.
//
// "Stops all automatic charge attempts" has to mean something at Whop, not just in our database.
// Whop pauses a membership's recurring collection while keeping the customer's access, which is
// exactly the shape of manual billing: stop charging, keep serving.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";

export type BillingMode = "automatic" | "manual";

export type BillingModeResult = {
  mode: BillingMode;
  /** Set when our side changed but the provider did not — the dangerous half-state. */
  warning: string | null;
};

export async function setBillingMode(tenantId: string, mode: BillingMode): Promise<BillingModeResult> {
  const supabase = getSupabaseServiceClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, whop_membership_id")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; whop_membership_id: string | null }>();

  let warning: string | null = null;

  if (!subscription?.whop_membership_id) {
    // Without a membership id there is nothing to pause. Said plainly, because the whole point of
    // manual billing is that the provider stops charging — a tenant marked manual while Whop keeps
    // billing would be charged twice, by card and by invoice.
    warning =
      mode === "manual"
        ? "No provider membership is known for this tenant, so automatic charging could NOT be stopped at the provider. Verify before invoicing them."
        : null;
  } else {
    try {
      const whop = buildProvider("whop");
      if (whop instanceof WhopProvider) {
        if (mode === "manual") await whop.pauseMembership(subscription.whop_membership_id);
        else await whop.resumeMembership(subscription.whop_membership_id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Deliberately NOT swallowed into a success: our flag saying manual while Whop still charges
      // is worse than the switch failing outright.
      throw new Error(`Could not ${mode === "manual" ? "pause" : "resume"} billing at the provider: ${message}`);
    }
  }

  const { error } = await supabase.from("tenants").update({ billing_mode: mode }).eq("id", tenantId);
  if (error) throw new Error(`Could not record the billing mode: ${error.message}`);

  return { mode, warning };
}
