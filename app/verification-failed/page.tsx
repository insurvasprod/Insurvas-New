import Link from "next/link";

import { AppAuthFrame } from "@/components/app/app-auth-frame";
import { AuthCard } from "@/components/app/auth-card";
import { Button } from "@/components/ui/button";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

/**
 * Where an expired or already-used verification link lands (p-pub-verification-failed).
 *
 * There is no session here, so a resend button could not work; the way forward is signing in, where
 * a pending account is offered a fresh link at once — and an account that already verified with
 * this link simply goes in. The lifetime is read from the same constant the link is issued with.
 * In the sign-in frame since the redesign (2026-10-24), like the other account doors.
 */
export default function VerificationFailedPage() {
  return (
    <AppAuthFrame>
      <AuthCard
        width={640}
        title="That link no longer works"
        description={`It was already used, or it expired: verification links work once and last ${EMAIL_VERIFICATION_TTL_HOURS} hours. Sign in and we will send a fresh one, or take you straight in if your email is already confirmed.`}
      >
        <Button asChild className="mt-6 h-12 w-full">
          <Link href="/app/login">Sign in</Link>
        </Button>
        <p className="mt-4 text-sm leading-normal text-muted-foreground">
          Still stuck? Write to <a href="mailto:support@insurvas.com?subject=Verification%20link" className="font-semibold text-foreground">support@insurvas.com</a>.
        </p>
      </AuthCard>
    </AppAuthFrame>
  );
}
