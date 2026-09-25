import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

/**
 * Where an expired or already-used verification link lands (p-pub-verification-failed).
 *
 * There is no session here, so a resend button could not work; the way forward is signing in, where
 * a pending account is offered a fresh link at once — and an account that already verified with
 * this link simply goes in. The lifetime is read from the same constant the link is issued with.
 */
export default function VerificationFailedPage() {
  return (
    <div className="m-stagger flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6 sm:p-10">
      <div className="w-full max-w-[580px]">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
          <h1 className="text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
            That link no longer works
          </h1>
          <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            It was either already used or it expired. Verification links last {EMAIL_VERIFICATION_TTL_HOURS} hours and work once.
          </p>

          <div className="mt-6 rounded-xl border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
            <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">
              You did not do anything wrong
            </div>
            <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
              Sign in with the email and password you signed up with. If your email still needs verifying, you can send
              yourself a fresh link straight away; if you already verified it, you will go straight in.
            </p>
          </div>

          <div className="mt-6">
            <Button asChild className="h-12 w-full">
              <Link href="/app/login">Sign in and resend</Link>
            </Button>
          </div>
          <p className="mt-4 text-center text-xs leading-normal text-muted-foreground">
            Still stuck? Write to <a href="mailto:support@insurvas.com?subject=Verification%20link" className="font-semibold text-foreground">support@insurvas.com</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
