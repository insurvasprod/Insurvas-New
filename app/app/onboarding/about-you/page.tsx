import { redirect } from "next/navigation";

import { AboutYouForm } from "@/components/app/about-you-form";
import { FunnelFrame } from "@/components/app/funnel-frame";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { fetchPlanChoices, readPlanChoice } from "@/lib/signup/planChoiceQueries";

/** First visit, or Back from the plan/payment step before the plan starts. */
const ABOUT_YOU_STATES = new Set(["about_you", "ready_for_checkout", "awaiting_payment"]);

export default async function AboutYouPage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  if (context.userStatus !== "active" || !ABOUT_YOU_STATES.has(context.onboardingState)) {
    redirect(signupDestination(context) ?? "/app/dashboard");
  }
  const [{ plans }, saved] = await Promise.all([fetchPlanChoices(), readPlanChoice(context.tenantId)]);
  const audience = plans.find((plan) => plan.code === saved?.planCode)?.audience ?? null;
  return <FunnelFrame step={3}><AboutYouForm fullName={context.name} phone={context.phone ?? ""} audience={audience} /></FunnelFrame>;
}
