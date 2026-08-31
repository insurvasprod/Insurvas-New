import { redirect } from "next/navigation";

import { resolveSignupContext } from "@/lib/signup/context";
import { completeCheckout } from "@/lib/checkout/complete";
import { verifyCheckoutWithProvider } from "@/lib/checkout/verify";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * SA-5.2 · Where Whop sends the customer after they enter a card.
 *
 * This URL is reachable by anyone with a session — it is a GET with no secret in it — so landing
 * here proves nothing on its own. It previously trusted the tenant's local plan selection and
 * created a trial subscription outright, which meant typing the address into the bar was enough to
 * be given the product for free (bugs_sa.md #1).
 *
 * So the handler now ASKS WHOP whether a membership actually exists for this tenant before it
 * grants anything. The membership.activated webhook remains the second, independent path, for the
 * customer who pays and closes the tab. Two authorities, both signed or verified, neither trusting
 * the browser.
 *
 * Note this page never sees a card. Whop collected it; we learn only whether checkout finished.
 */
export default async function CheckoutReturnPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");

  const supabase = getSupabaseServiceClient();
  const { data: session } = await supabase
    .from("checkout_sessions")
    .select("plan_id, billing_cycle")
    .eq("tenant_id", context.tenantId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .maybeSingle<{ plan_id: string; billing_cycle: "monthly" | "quarterly" | "yearly" }>();

  // No open checkout means there is nothing here to complete — either they already finished (the
  // webhook got there first) or they never started. Either way, the shell decides where they go.
  if (!session) redirect("/app/dashboard");

  const verification = await verifyCheckoutWithProvider({
    tenantId: context.tenantId,
    planId: session.plan_id,
    billingCycle: session.billing_cycle,
  });

  if (!verification.confirmed) {
    // Deliberately NOT an error page. The common cause is a customer who reached checkout and
    // backed out, and telling them something went wrong would be false. The uncommon cause is a
    // real payment Whop has not finished recording, and the webhook completes that within seconds.
    console.warn(
      `[checkout] return for tenant ${context.tenantId} not completed: ${verification.reason}`,
    );
    redirect("/app/checkout?pending=1");
  }

  try {
    await completeCheckout(context.tenantId, {
      membershipId: verification.membershipId,
      planId: session.plan_id,
      billingCycle: session.billing_cycle,
      source: "return",
    });
  } catch (error) {
    // The customer HAS paid — Whop just confirmed it. Sending them to a failure screen because our
    // bookkeeping stumbled would be the wrong call; the webhook will complete it, so let them
    // through and shout about it on our side.
    console.error(`[checkout] completing on return failed for ${context.tenantId}:`, error);
  }

  redirect("/app/dashboard?welcome=1");
}
