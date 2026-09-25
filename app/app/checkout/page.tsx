import { redirect } from "next/navigation";

import { CheckoutView } from "@/components/public/checkout-view";
import { TRIAL_DAYS } from "@/lib/checkout/constants";
import { dayMonthYear } from "@/lib/format/dates";
import { formatCentsAsCurrency, priceForCycle, type BillingCycle, type PlanPrices } from "@/lib/money";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** When a trial started now ends: the cancel-by date and the first charge. Read per request. */
function trialEndDate() {
  return new Date(Date.now() + TRIAL_DAYS * 86_400_000);
}

export default async function CheckoutHandoffPage({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active") redirect("/app/login");
  const destination = signupDestination(context);
  if (destination && destination !== "/app/checkout") redirect(destination);
  const { pending } = await searchParams;

  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase
    .from("signup_selections")
    .select("plan_id, billing_cycle")
    .eq("tenant_id", context.tenantId)
    .maybeSingle<{ plan_id: string; billing_cycle: BillingCycle }>();

  const [{ data: plan }, { data: prices }, { data: features }, { data: limits }] = selection
    ? await Promise.all([
        supabase.from("plans").select("name").eq("id", selection.plan_id).maybeSingle<{ name: string }>(),
        supabase.from("plan_prices").select("*").eq("plan_id", selection.plan_id).maybeSingle<PlanPrices>(),
        supabase.from("plan_features").select("feature_key").eq("plan_id", selection.plan_id),
        supabase.from("plan_limits").select("max_seats").eq("plan_id", selection.plan_id).maybeSingle<{ max_seats: number | null }>(),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

  const cycle = selection?.billing_cycle ?? null;
  const priceCents = cycle ? priceForCycle(prices, cycle) : null;

  // "Inbound + outbound · 12 seats · billed monthly", from what the plan actually grants. A part the
  // plan does not define is left out rather than guessed.
  const keys = new Set((features ?? []).map((row: { feature_key: string }) => row.feature_key));
  const inbound = keys.has("inbound_transfers");
  const outbound = keys.has("outbound_dialing");
  const moduleLine = inbound && outbound ? "Inbound + outbound" : inbound ? "Inbound" : outbound ? "Outbound" : null;
  const seats = limits?.max_seats ? `${limits.max_seats} seat${limits.max_seats === 1 ? "" : "s"}` : null;

  return (
    <CheckoutView
      planName={plan?.name ?? null}
      planLine={[moduleLine, seats, cycle ? `billed ${cycle}` : null].filter(Boolean).join(" · ")}
      cycle={cycle}
      price={priceCents === null ? null : formatCentsAsCurrency(priceCents)}
      // Card at signup, not charged for the trial — the constant the checkout itself opens with.
      trialDays={TRIAL_DAYS}
      trialEnds={dayMonthYear(trialEndDate(), "UTC")}
      pending={pending === "1"}
    />
  );
}
