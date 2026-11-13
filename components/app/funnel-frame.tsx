import { Children, isValidElement, type ReactNode } from "react";

import { AuthHeading, AuthLayout, AuthSteps } from "@/components/portal/auth-layout";

/**
 * The five sign-up steps (owner, 2026-10-26): account, email, agency, plan, payment. The plan has its
 * own step now; before, it sat on the account form and step 4 was the trial.
 */
// Manager review, 2026-10-28: payment before the business questions, so "About you" is last; it reads
// right for one agent and for an agency. The showcase opens on feature N at step N.
//
// Manager review, 2026-10-28 (§1.9): three steps, not five. The screens keep their own numbers (1 account,
// 2 email, 3 plan, 4 payment, 5 About you, 6 welcome), which the showcase reads to pick its feature; the
// progress line groups them: the email check belongs to the account, the plan to its payment.
export const FUNNEL_STEPS = ["Your account", "Plan & payment", "About you"] as const;
/** A sign-up screen. 6 is the welcome screen after the plan starts: every step done. */
export type FunnelStep = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_OF_SCREEN: Record<FunnelStep, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4 };

/** The step a screen belongs to, 1–3; 4 means every step is done. */
export function funnelStepOf(screen: FunnelStep): number {
  return STEP_OF_SCREEN[screen];
}

/** "Step 1 of 3 · Your account" over three bars: the one AuthSteps, with the sign-up step names. */
export function FunnelStepper({ step }: { step: FunnelStep }) {
  const current = funnelStepOf(step);
  return <AuthSteps current={current} total={FUNNEL_STEPS.length} label={FUNNEL_STEPS[current - 1]} labels={FUNNEL_STEPS} ariaLabel="Sign-up progress" />;
}

/**
 * The sign-up journey's frame: the one auth layout (components/portal/auth-layout.tsx) with the
 * sign-up stepper. The agent photo panel stays in place across the journey; steps with real panel
 * content (the plan summary and receipt) pass it as `aside` over that panel.
 */
export function FunnelFrame({ step, children, wide = false, aside, back, stepsAside, legal = true, heading }: {
  /** The step's heading, drawn above the card on the brand field. Without it, a leading FunnelHeading child is lifted. */
  heading?: ReactNode;
  /** The Privacy · Terms · Support line under the form; Payment shows it in its summary instead. */
  legal?: boolean;
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
  // The step's own heading is its first child; drawn above the card, not inside it (single layout only).
  const nodes = Children.toArray(children);
  const first = nodes[0];
  const liftHeading = !aside && isValidElement(first) && (first.type === FunnelHeading || first.type === AuthHeading);

  return (
    <AuthLayout
      plane="agent"
      mode="sign-up"
      photo
      width={wide ? "wide" : "default"}
      // On the centred card the other way in ("Have an account? Sign in") sits under the card, like the sign-in's;
      // beside a panel it stays on the step line.
      steps={{ current: funnelStepOf(step), total: FUNNEL_STEPS.length, label: FUNNEL_STEPS[funnelStepOf(step) - 1], labels: FUNNEL_STEPS, ariaLabel: "Sign-up progress", aside: aside ? stepsAside : undefined }}
      footer={!aside && stepsAside ? <div className="text-sm leading-normal tracking-[-0.02em]">{stepsAside}</div> : undefined}
      footerInline
      back={back}
      legal={legal}
      heading={heading ?? (liftHeading ? first : undefined)}
      story={aside}
    >
      {liftHeading ? nodes.slice(1) : children}
    </AuthLayout>
  );
}

/** The title block every funnel step opens with: the one AuthHeading. */
export function FunnelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <AuthHeading title={title}>{children}</AuthHeading>;
}
