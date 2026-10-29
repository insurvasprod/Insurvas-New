import "server-only";

// Checkout with no payment (CHECKOUT_PAYMENT_MODE=none, lib/checkout/paymentMode.ts).
//
// The owner presses the checkout button and the plan they chose at signup starts at once, through
// the same completeCheckout a paid checkout ends in — so the subscription, the entitlement, the
// tenant turning active and the onboarding finishing are exactly what a paid customer gets. No
// provider is called, no card is asked for, and nobody in the admin console has to assign a plan.

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/transport";
import { workspaceReadyEmail } from "@/lib/email/templates";
import { configuredAppOrigin } from "@/lib/urls/origin";
import type { BillingCycle } from "@/lib/money";
import { completeCheckout } from "./complete";
import { AFTER_PAYMENT } from "../signup/destination";

/**
 * Where the owner goes once the plan is on, the same as a paid checkout: "About you", the last
 * sign-up step, which forwards to the dashboard when the profile is already saved (manager review,
 * 2026-10-28: payment before the business questions). /app/welcome stays reachable from Get set up.
 */
export const NO_PAYMENT_LANDING = AFTER_PAYMENT;

export async function completeWithoutPayment(
  tenantId: string,
  plan: { id: string; name: string },
  billingCycle: BillingCycle,
): Promise<{ subscriptionId: string; created: boolean }> {
  const supabase = getSupabaseServiceClient();

  // Manual billing first: nothing may ever try to charge a workspace that never gave a card.
  const { error: modeError } = await supabase.from("tenants").update({ billing_mode: "manual" }).eq("id", tenantId);
  if (modeError) throw new Error(`Could not set manual billing: ${modeError.message}`);

  const completion = await completeCheckout(tenantId, { planId: plan.id, billingCycle, source: "no_payment" });
  if (!completion) throw new Error("The plan could not be started");

  // Only the call that created the subscription says hello, so a double click sends one email.
  if (completion.created) {
    try {
      const { data: owner } = await supabase
        .from("tenant_users")
        .select("users!inner(id, email, name)")
        .eq("tenant_id", tenantId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle<{ users: { id: string; email: string; name: string | null } }>();
      if (owner?.users?.email) {
        await sendEmail({
          to: owner.users.email,
          ...workspaceReadyEmail({ name: owner.users.name || "there", planName: plan.name, signInUrl: `${configuredAppOrigin("agent")}/app/login` }),
          templateKey: "subscription.workspace_ready",
          tenantId,
          userId: owner.users.id,
          dedupeKey: `workspace-ready-${completion.subscriptionId}`,
        });
      }
    } catch (error) {
      // The plan is on either way; a missed welcome email must not undo it.
      console.error(`[checkout] workspace-ready email for ${tenantId} failed`, error);
    }
  }

  return { subscriptionId: completion.subscriptionId, created: completion.created };
}
