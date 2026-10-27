import { redirect } from "next/navigation";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { PlanChoiceForm, PlanChoiceProvider, PlanChoiceSummary } from "@/components/app/plan-choice";
import { TRIAL_DAYS } from "@/lib/checkout/constants";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { dayMonthYear } from "@/lib/format/dates";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { fetchPlanChoices, readPlanChoice } from "@/lib/signup/planChoiceQueries";

/** The plan can be chosen after Your agency, and changed again from Payment until the plan starts. */
const CHOOSABLE = new Set(["ready_for_checkout", "awaiting_payment"]);

/** When a trial started now ends, as Payment shows it. Read per request. */
function trialEndDate() {
  return new Date(Date.now() + TRIAL_DAYS * 86_400_000);
}

/**
 * Step 4 of 5, Your plan (owner pick B, 2026-10-26): who it is for, plan and billing, seats, and the
 * add-on modules the plan offers. The brand story makes way for a live summary of the choice.
 */
export default async function PlanStepPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active" || !CHOOSABLE.has(context.onboardingState)) redirect(signupDestination(context) ?? "/app/dashboard");

  const [{ plans, modules }, saved] = await Promise.all([fetchPlanChoices(), readPlanChoice(context.tenantId)]);
  if (context.onboardingState === "ready_for_checkout" && saved?.selectedFromPricing) redirect("/app/checkout");
  if (plans.length === 0) {
    return (
      <FunnelFrame step={4}>
        <FunnelHeading title="Choose your plan">No plan is open for sign-up right now. Write to support@insurvas.com and we will set you up.</FunnelHeading>
      </FunnelFrame>
    );
  }

  return (
    <PlanChoiceProvider
      plans={plans}
      modules={modules}
      initial={saved}
      trialEnds={dayMonthYear(trialEndDate(), "UTC")}
      noPayment={checkoutPaymentMode() === "none"}
    >
      <FunnelFrame step={4} wide aside={<PlanChoiceSummary />}>
        <PlanChoiceForm />
      </FunnelFrame>
    </PlanChoiceProvider>
  );
}
