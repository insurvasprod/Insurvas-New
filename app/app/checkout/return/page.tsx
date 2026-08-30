import { redirect } from "next/navigation";

import { resolveSignupContext } from "@/lib/signup/context";
import { completeCheckout } from "@/lib/checkout/complete";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * SA-5.2 · Where Whop sends the customer after they enter a card.
 *
 * The subscription and the entitlement are built HERE, synchronously, before the redirect
 * completes — the ticket's requirement that the product works the moment they land. The
 * membership.activated webhook does the same thing idempotently for anyone who pays and closes
 * the tab, so neither path is the only one and neither can double up.
 *
 * Note this page never sees a card. Whop collected it; we learn only that checkout finished.
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

  try {
    await completeCheckout(context.tenantId, {
      planId: session?.plan_id ?? null,
      billingCycle: session?.billing_cycle ?? null,
      source: "return",
    });
  } catch (error) {
    // The customer has paid. Sending them to a failure screen because OUR bookkeeping stumbled
    // would be the wrong call — the webhook will complete it, so let them into the product and
    // shout about it on our side.
    console.error(`[checkout] completing on return failed for ${context.tenantId}:`, error);
  }

  redirect("/app/dashboard?welcome=1");
}
