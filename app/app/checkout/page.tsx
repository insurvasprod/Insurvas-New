import { redirect } from "next/navigation";

import { CheckoutView } from "@/components/public/checkout-view";
import { TRIAL_DAYS } from "@/lib/checkout/constants";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { dayMonthYear } from "@/lib/format/dates";
import { formatCentsAsCurrency, priceForCycle, type BillingCycle, type PlanPrices } from "@/lib/money";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { readPlanChoice } from "@/lib/signup/planChoiceQueries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** When a trial started now ends: the cancel-by date and the first charge. Read per request. */
function trialEndDate() {
  return new Date(Date.now() + TRIAL_DAYS * 86_400_000);
}

/** The Whop environment our API key belongs to, so the embedded form talks to the same one. */
function whopEnvironment(): "production" | "sandbox" {
  return /sandbox/i.test(process.env.WHOP_API_BASE_URL ?? "") ? "sandbox" : "production";
}

export default async function CheckoutHandoffPage({ searchParams }: { searchParams: Promise<{ pending?: string; failed?: string }> }) {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active") redirect("/app/login");
  // The plan has started: nothing is left to pay, and opening a checkout would only undo that.
  if (context.onboardingState === "completed") redirect("/app/dashboard");
  // A live plan with sign-up still marked unfinished (a later checkout open used to reset it, 2026-10-26):
  // finish the sign-up here instead of trapping the owner between the dashboard and this page.
  const { data: live } = await getSupabaseServiceClient()
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (live) {
    const { error: finishError } = await getSupabaseServiceClient()
      .from("tenants")
      .update({ onboarding_state: "completed" })
      .eq("id", context.tenantId)
      .in("onboarding_state", ["ready_for_checkout", "awaiting_payment"]);
    // Not silently: the shell would send the owner straight back here, round and round.
    if (finishError) throw new Error(`Could not finish sign-up for ${context.tenantId}: ${finishError.message}`);
    redirect("/app/dashboard");
  }
  const destination = signupDestination(context);
  // Payment follows the plan step; an owner who has chosen comes here from it while still ready_for_checkout.
  if (destination && destination !== "/app/checkout" && destination !== "/app/onboarding/plan") redirect(destination);
  const { pending, failed } = await searchParams;

  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase
    .from("signup_selections")
    .select("plan_id, billing_cycle")
    .eq("tenant_id", context.tenantId)
    .maybeSingle<{ plan_id: string; billing_cycle: BillingCycle }>();

  const [{ data: plan }, { data: prices }, { data: features }, { data: limits }, choice] = selection
    ? await Promise.all([
        supabase.from("plans").select("name").eq("id", selection.plan_id).maybeSingle<{ name: string }>(),
        supabase.from("plan_prices").select("*").eq("plan_id", selection.plan_id).maybeSingle<PlanPrices>(),
        supabase.from("plan_features").select("feature_key").eq("plan_id", selection.plan_id),
        supabase.from("plan_limits").select("max_seats").eq("plan_id", selection.plan_id).maybeSingle<{ max_seats: number | null }>(),
        // The seats and add-ons from Step 4 of 5 (kept once 20261026300000 is applied).
        readPlanChoice(context.tenantId),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }, null];

  const { data: addonRows } = choice?.addonCodes.length
    ? await supabase.from("addons").select("code, name, price_cents, billing_cycle").in("code", choice.addonCodes)
    : { data: [] as { code: string; name: string; price_cents: number; billing_cycle: BillingCycle }[] };

  const cycle = selection?.billing_cycle ?? null;
  const priceCents = cycle ? priceForCycle(prices, cycle) : null;

  // "Inbound + outbound · 12 seats · billed monthly", from what the plan actually grants. A part the
  // plan does not define is left out rather than guessed.
  const keys = new Set((features ?? []).map((row: { feature_key: string }) => row.feature_key));
  const inbound = keys.has("inbound_transfers");
  const outbound = keys.has("outbound_dialing");
  const moduleLine = inbound && outbound ? "Inbound + outbound" : inbound ? "Inbound" : outbound ? "Outbound" : null;
  // The seats asked for on the plan step; the plan's ceiling when none were saved.
  const seatCount = choice?.seats ?? limits?.max_seats ?? null;
  const seats = seatCount ? `${seatCount} seat${seatCount === 1 ? "" : "s"}` : null;

  return (
    <CheckoutView
      planName={plan?.name ?? null}
      planLine={[moduleLine, seats, cycle ? `billed ${cycle}` : null].filter(Boolean).join(" · ")}
      cycle={cycle}
      price={priceCents === null ? null : formatCentsAsCurrency(priceCents)}
      setupFee={prices?.setup_fee_cents ? formatCentsAsCurrency(prices.setup_fee_cents) : null}
      // Card at signup, not charged for the trial — the constant the checkout itself opens with.
      trialDays={TRIAL_DAYS}
      trialEnds={dayMonthYear(trialEndDate(), "UTC")}
      addons={(addonRows ?? []).map((addon) => ({ name: addon.name, price: formatCentsAsCurrency(addon.price_cents), cycle: addon.billing_cycle }))}
      pending={pending === "1"}
      failed={failed === "1"}
      email={context.email}
      environment={whopEnvironment()}
      noPayment={checkoutPaymentMode() === "none"}
    />
  );
}
