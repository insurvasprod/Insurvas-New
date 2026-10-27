import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { FunnelReview } from "@/components/app/funnel-review";
import { LogoutButton } from "@/components/app/logout-button";
import { GoogleFinishForm } from "@/components/public/google-finish-form";
import { SignupForm } from "@/components/public/signup-form";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { googleSignInEnabled } from "@/lib/tenantAuth/google";
import { googleMessage } from "@/lib/tenantAuth/googleMessages";
import { GOOGLE_SIGNUP_COOKIE, verifyGoogleSignupToken } from "@/lib/tenantAuth/session";

export const metadata: Metadata = {
  title: "Create account · Insurvas",
  description: "Create your Insurvas account and workspace.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string; google?: string }>;
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
          rows={[{ label: "Name", value: context.name }, { label: "Email", value: context.email }]}
          // Continue returns to where the signup stands; Next walks one step forward (owner, 2026-10-27).
          continueHref={destination}
          next={{ href: "/app/verify-email", label: "Your email" }}
        >
          <p className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Not you?</span>
            <LogoutButton variant="link" className="text-sm font-semibold text-foreground hover:text-[var(--accent-ink)]" />
          </p>
        </FunnelReview>
      </FunnelFrame>
    );
  }
  // Back from Google with a new address: only the phone and the terms are left (owner, 2026-10-27).
  // Who the person is comes from the signed cookie the callback set, never from the URL.
  if (query.google === "finish") {
    const google = await verifyGoogleSignupToken((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value ?? "");
    if (google) {
      return (
        <FunnelFrame step={1} stepsAside={<>Not you? <Link href="/signup" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Use another email</Link></>}>
          <GoogleFinishForm email={google.email} name={google.name} />
        </FunnelFrame>
      );
    }
  }
  const googleEnabled = await googleSignInEnabled();
  const signIn = (
    <>Have an account? <Link href="/app/login" className="font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline">Sign in</Link></>
  );
  return (
    <FunnelFrame step={1} stepsAside={signIn}>
      <SignupForm
        initialPlanCode={query.plan}
        initialCycle={query.cycle}
        noPayment={checkoutPaymentMode() === "none"}
        googleEnabled={googleEnabled}
        notice={query.google === "finish" ? googleMessage("expired") : googleMessage(query.google)}
      />
    </FunnelFrame>
  );
}
