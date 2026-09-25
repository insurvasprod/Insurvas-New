import { redirect } from "next/navigation";

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
export default async function CheckoutReturnPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");

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
    <div className="portal-agent flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] px-4 py-10 sm:p-10">
      {/* Not a direct `main` child: the shell's `.portal-agent > main` reserves 264px for a sidebar. */}
      <div className="w-full max-w-[680px]">
        <main className="m-in rounded-lg border border-border bg-card p-6 sm:p-10">
          <h1 className="mt-2 text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
            Confirming with the payment provider
          </h1>
          <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            This usually takes a few seconds. Access is granted by the provider’s answer, never by arriving at this URL.
          </p>
          <CheckoutReturnStatus />
        </main>
      </div>
    </div>
  );
}
