import { NextResponse } from "next/server";

import { resolveSignupContext } from "@/lib/signup/context";
import { completeCheckout } from "@/lib/checkout/complete";
import { verifyCheckoutWithProvider } from "@/lib/checkout/verify";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * SA-5.2 · One attempt at confirming a returned checkout with the provider.
 *
 * The return page used to do this before it rendered anything, so the customer stared at a blank
 * tab while Whop answered. It now shows "Confirming with the payment provider" at once and calls
 * this, a few times, until the answer arrives.
 *
 * The rule is unchanged: arriving proves nothing. Access is granted only when WHOP says a
 * membership exists for this tenant; the membership.activated webhook stays the second, independent
 * path. The browser learns an outcome and never supplies one — the request carries no body.
 *
 *   `done`      — no open checkout: the webhook finished it first, or there was nothing to finish.
 *   `confirmed` — Whop confirmed; completion was attempted (and the webhook backs it up if not).
 *   `pending`   — not confirmed yet. The caller may ask again; this is not an error.
 */
export async function POST() {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getSupabaseServiceClient();
  // limit(1) is load-bearing: a tenant can hold several open sessions (each couponed start opens a
  // new one), and maybeSingle() over more than one row returns an error and no data — which read
  // as "done" and sent a customer who had just paid back to checkout to pay again.
  const { data: session, error: sessionError } = await supabase
    .from("checkout_sessions")
    .select("plan_id, billing_cycle")
    .eq("tenant_id", context.tenantId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_id: string; billing_cycle: "monthly" | "quarterly" | "yearly" }>();

  const noStore = { headers: { "Cache-Control": "no-store" } };
  // A failed read proves nothing either way, so it is "ask again", never "done".
  if (sessionError) {
    console.error(`[checkout] could not read the open session for tenant ${context.tenantId}: ${sessionError.message}`);
    return NextResponse.json({ status: "pending" }, noStore);
  }
  if (!session) return NextResponse.json({ status: "done" }, noStore);

  const verification = await verifyCheckoutWithProvider({
    tenantId: context.tenantId,
    planId: session.plan_id,
    billingCycle: session.billing_cycle,
  });

  if (!verification.confirmed) {
    // Deliberately not an error. The common cause is a customer who backed out of checkout; the
    // uncommon one is a real payment Whop has not finished recording, which the webhook completes.
    console.warn(`[checkout] return for tenant ${context.tenantId} not confirmed yet: ${verification.reason}`);
    return NextResponse.json({ status: "pending" }, noStore);
  }

  try {
    await completeCheckout(context.tenantId, {
      membershipId: verification.membershipId,
      planId: session.plan_id,
      billingCycle: session.billing_cycle,
      source: "return",
    });
  } catch (error) {
    // The customer HAS paid — Whop just confirmed it. Failing them over our bookkeeping would be
    // the wrong call; the webhook will complete it, so let them through and shout about it here.
    console.error(`[checkout] completing on return failed for ${context.tenantId}:`, error);
  }

  return NextResponse.json({ status: "confirmed" }, noStore);
}
