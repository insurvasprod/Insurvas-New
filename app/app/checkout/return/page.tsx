import { redirect } from "next/navigation";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { CheckoutReturnStatus } from "@/components/public/checkout-return-status";
import { resolveSignupContext } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * SA-5.2 · Where Whop sends the customer after they enter a card.
 *
 * This URL is reachable by anyone with a session — it is a GET with no secret in it — so landing
 * here proves nothing on its own. It once trusted the tenant's local plan selection and created a
 * trial subscription outright, which meant typing the address into the bar was enough to be given
 * the product for free (bugs_sa.md #1).
 *
 * So nothing here grants anything. The page shows "Confirming with the payment provider" at once,
 * and CheckoutReturnStatus asks /api/app/checkout/verify — which asks WHOP whether a membership
 * exists — until the answer arrives. The membership.activated webhook remains the second,
 * independent path, for the customer who pays and closes the tab.
 *
 * Note this page never sees a card. Whop collected it; we learn only whether checkout finished.
 */
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");

  // The embedded form returns here after an off-site step (a bank page, 3-D Secure) whatever happened,
  // with Whop's `status`. A failed or cancelled one goes back to Payment with the reason, not into a
  // wait for a payment that will never arrive. "succeeded" is still only a hint: Whop is asked below.
  const { status } = await searchParams;
  if (status === "failed" || status === "canceled") redirect("/app/checkout?failed=1");

  // No open checkout means there is nothing here to confirm — either they already finished (the
  // webhook got there first) or they never started. Either way, the shell decides where they go.
  const { data: session } = await getSupabaseServiceClient()
    .from("checkout_sessions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (!session) redirect("/app/dashboard");

  return (
    <FunnelFrame step={2}>
      <FunnelHeading title="Starting your trial">This usually takes a few seconds.</FunnelHeading>
      <CheckoutReturnStatus />
    </FunnelFrame>
  );
}
