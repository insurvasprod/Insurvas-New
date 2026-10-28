import { redirect } from "next/navigation";

import { FunnelFrame, FunnelHeading } from "@/components/app/funnel-frame";
import { PlanChoiceForm, PlanChoiceProvider, PlanChoiceSummary } from "@/components/app/plan-choice";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { PLAN_CHOOSABLE_STATES } from "@/lib/signup/destination";
import { fetchPlanChoices, readPlanChoice } from "@/lib/signup/planChoiceQueries";

/** The plan can be chosen after Your agency, and changed again from Payment until the plan starts. */
const CHOOSABLE = new Set<string>(PLAN_CHOOSABLE_STATES);

/**
 * Step 3 of 5, Your plan (owner pick B, 2026-10-26): who it is for, plan and billing, and seats. No
 * add-on modules at sign-up (owner, 2026-10-27). The brand story makes way for a live summary of the choice.
 */
export default async function PlanStepPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active" || !CHOOSABLE.has(context.onboardingState)) redirect(signupDestination(context) ?? "/app/dashboard");

  const [{ plans, modules }, saved] = await Promise.all([fetchPlanChoices(), readPlanChoice(context.tenantId)]);
  if (plans.length === 0) {
    return (
      <FunnelFrame step={3}>
        <FunnelHeading title="Choose your plan">No plan is open for sign-up right now. Write to support@insurvas.com and we will set you up.</FunnelHeading>
      </FunnelFrame>
    );
  }

  return (
    <PlanChoiceProvider
      plans={plans}
      modules={modules}
      initial={saved}
      now={new Date().toISOString()}
      noPayment={checkoutPaymentMode() === "none"}
    >
      <FunnelFrame step={3} wide aside={<PlanChoiceSummary />}>
        <PlanChoiceForm />
      </FunnelFrame>
    </PlanChoiceProvider>
  );
}
