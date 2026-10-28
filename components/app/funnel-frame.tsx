import type { ReactNode } from "react";

import { AuthHeading, AuthLayout, AuthSteps } from "@/components/portal/auth-layout";
import { StoryPanel } from "@/components/app/tenant-auth-workspace";
import { checkoutPaymentMode } from "@/lib/checkout/paymentMode";

/**
 * The five sign-up steps (owner, 2026-10-26): account, email, agency, plan, payment. The plan has its
 * own step now; before, it sat on the account form and step 4 was the trial.
 */
// Step 3 is "About you" (manager review, 2026-10-28): it reads right for one agent and for an agency.
export const FUNNEL_STEPS = ["Your account", "Your email", "About you", "Your plan", "Payment"] as const;
/** 6 is the welcome screen after the plan starts: every step done. */
export type FunnelStep = 1 | 2 | 3 | 4 | 5 | 6;

/** "Step 2 of 5 · Your email" over five bars: the one AuthSteps, with the sign-up step names. */
export function FunnelStepper({ step }: { step: FunnelStep }) {
  return <AuthSteps current={step} total={FUNNEL_STEPS.length} label={FUNNEL_STEPS[step - 1]} labels={FUNNEL_STEPS} ariaLabel="Sign-up progress" />;
}

/**
 * The sign-up journey's frame: the one auth layout (components/portal/auth-layout.tsx) with the
 * sign-up stepper. The brand panel is the one sign-in and sign-up already show (owner, 2026-10-24:
 * "the right side leave it as it is") — the trial story for the steps before the plan starts, the
 * floor story once it has.
 */
export function FunnelFrame({ step, children, wide = false, aside, back, stepsAside }: {
  step: FunnelStep;
  children: ReactNode;
  /** A step with many choices (2026-10-26, Your agency): the column is wider so they spread out instead of scrolling. */
  wide?: boolean;
  /** In place of the brand story: Your plan puts its live summary there (owner pick B, 2026-10-26). */
  aside?: ReactNode;
  /** "← Back to …" above the heading (signup-flow decides which steps have one). */
  back?: { href: string; label: string };
  /** On the right of the step line: "Have an account? Sign in" on step 1. */
  stepsAside?: ReactNode;
}) {
  return (
    <AuthLayout
      plane="agent"
      mode="sign-up"
      width={wide ? "wide" : "default"}
      steps={{ current: step, total: FUNNEL_STEPS.length, label: FUNNEL_STEPS[step - 1], labels: FUNNEL_STEPS, ariaLabel: "Sign-up progress", aside: stepsAside }}
      back={back}
      story={aside ?? <StoryPanel mode={step === 6 ? "sign-in" : "sign-up"} step={step} noPayment={checkoutPaymentMode() === "none"} />}
    >
      {children}
    </AuthLayout>
  );
}

/** The title block every funnel step opens with: the one AuthHeading. */
export function FunnelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <AuthHeading title={title}>{children}</AuthHeading>;
}
