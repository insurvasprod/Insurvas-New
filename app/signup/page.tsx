import type { Metadata } from "next";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { FunnelReview } from "@/components/app/funnel-review";
import { LogoutButton } from "@/components/app/logout-button";
import { SignupForm } from "@/components/public/signup-form";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";

export const metadata: Metadata = {
  title: "Create account · Insurvas",
  description: "Create your Insurvas account and workspace.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const query = await searchParams;
  // Back from step 2 lands here with the account already made: show it, not an empty form that
  // could only answer "an account already exists" (owner, 2026-10-27). Step 1 has no Back.
  const context = await resolveSignupContext();
  const destination = context ? signupDestination(context) : null;
  if (context && destination) {
    return (
      <FunnelFrame step={1}>
        <FunnelReview
          title="Your account is created"
          subtitle="Carry on from where you left off."
          rows={[{ label: "Name", value: context.name }, { label: "Work email", value: context.email }]}
          continueHref={destination}
        >
          <p className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Not you?</span>
            <LogoutButton variant="link" className="text-sm font-semibold text-foreground hover:text-[var(--accent-ink)]" />
          </p>
        </FunnelReview>
      </FunnelFrame>
    );
  }
  return (
    <FunnelFrame step={1}>
      <SignupForm initialPlanCode={query.plan} initialCycle={query.cycle} noPayment={checkoutPaymentMode() === "none"} />
    </FunnelFrame>
  );
}
