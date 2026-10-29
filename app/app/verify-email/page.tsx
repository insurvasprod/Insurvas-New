import { redirect } from "next/navigation";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { AccountCreatedPanel, EmailConfirmedPanel, VerifyEmailPanel } from "@/components/app/verify-email-panel";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ created?: string; confirmed?: string }> }) {
  const query = await searchParams;
  if (query.created === "1" || query.confirmed === "1") {
    const context = await resolveSignupContext();
    if (!context) redirect("/app/login");
    if (query.created === "1" && context.userStatus === "pending_verification") {
      return <FunnelFrame step={1}><AccountCreatedPanel /></FunnelFrame>;
    }
    if (query.confirmed === "1" && context.userStatus === "active" && ["about_you", "ready_for_checkout", "business_profile"].includes(context.onboardingState)) {
      const nextHref = signupDestination(context) ?? "/app/onboarding/plan";
      return <FunnelFrame step={1}><EmailConfirmedPanel nextHref={nextHref} /></FunnelFrame>;
    }
    if (context.userStatus === "pending_verification") redirect("/app/verify-email");
    redirect(signupDestination(context) ?? "/app/dashboard");
  }

  return (
    <FunnelFrame step={1}>
      <VerifyEmailPanel ttlHours={EMAIL_VERIFICATION_TTL_HOURS} noPayment={checkoutPaymentMode() === "none"} />
    </FunnelFrame>
  );
}
