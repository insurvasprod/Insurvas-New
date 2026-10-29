import { ViewTransition, type ReactNode } from "react";
import Link from "next/link";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { AuthBrand, PortalAuthSplitShell } from "@/components/portal/portal-auth-split-shell";
import { AuthShowcase } from "@/components/app/auth-showcase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The sign-up steps: account, email, about you, plan, payment, optional business setup.
 */
/**
 * Three steps, as the manager asked (review 2026-10-28, §1.9): the account (with its email check), the
 * plan and payment, then About you with optional business details. 4 is the "workspace ready" screen.
 */
export const FUNNEL_STEPS = ["Your account", "Plan & payment", "About you"] as const;
export type FunnelStep = 1 | 2 | 3 | 4;

/** A consistent bottom navigation row for steps that can move both backward and forward. */
export function FunnelStepFooter({ backHref, continueLabel = "Continue", busyLabel, busy = false, disabled = false, onContinue }: {
  backHref?: string;
  continueLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onContinue?: () => void;
}) {
  return (
    <div className={`mt-2 grid ${backHref ? "grid-cols-2" : "grid-cols-1"} gap-3`}>
      {backHref && <Button type="button" asChild variant="outline" className="h-12 w-full border-[var(--border-strong)]">
        <Link href={backHref}>Back</Link>
      </Button>}
      <Button type={onContinue ? "button" : "submit"} className="h-12 w-full" disabled={disabled || busy} onClick={onContinue}>
        {busy ? busyLabel ?? "Saving…" : continueLabel}
      </Button>
    </div>
  );
}

/** One progress indicator for the full sign-up journey, so no screen counts differently. */
export function FunnelStepper({ step }: { step: FunnelStep }) {
  const done = step > FUNNEL_STEPS.length;
  return (
    <div className="mb-8">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-muted-foreground">
        {done
          ? <span className="text-foreground">All {FUNNEL_STEPS.length} steps done</span>
          : <><span className="text-foreground">Step {step} of {FUNNEL_STEPS.length}</span> · {FUNNEL_STEPS[step - 1]}</>}
      </p>
      <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${FUNNEL_STEPS.length}, minmax(0, 1fr))` }} aria-label="Sign-up progress">
        {FUNNEL_STEPS.map((label, index) => (
          <li
            key={label}
            className={cn("h-1 rounded-full transition-colors duration-300", index < step ? "bg-[var(--primary)]" : "bg-border")}
            aria-current={index + 1 === step ? "step" : undefined}
          >
            <span className="sr-only">{label}{index + 1 < step ? ", done" : index + 1 === step ? ", current step" : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The sign-up journey's frame: the sign-in split shell with the stepper on the form side. The brand
 * panel is the one sign-in and sign-up already show (owner, 2026-10-24: "the right side leave it as
 * it is") — the trial story for the steps before the plan starts, the floor story once it has.
 */
export function FunnelFrame({ step, children, wide = false, aside }: {
  step: FunnelStep;
  children: ReactNode;
  /** A step with many choices (2026-10-26, Your agency): the column is wider so they spread out instead of scrolling. */
  wide?: boolean;
  /** In place of the brand story: Your plan puts its live summary there (owner pick B, 2026-10-26). */
  aside?: ReactNode;
}) {
  return (
    <PortalAuthSplitShell
      mode="sign-up"
      className="portal-agent portal-tenant-auth-shell"
      form={
        <div className="m-stagger portal-auth-form-inner" style={wide ? { maxWidth: 720 } : undefined}>
          {/* Logo and progress stay put between steps; only the step's own content moves (manager review, 14:41). */}
          <AuthBrand href="/" label="Insurvas home">
            <InsurvasLogo size="auth" />
          </AuthBrand>
          <ViewTransition name="funnel-stepper" share="funnel-still" default="none">
            <div><FunnelStepper step={step} /></div>
          </ViewTransition>
          {children}
          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      }
      story={aside ?? <AuthShowcase step={step} key={step} />}
    />
  );
}

/** The title block every funnel step opens with, sized like the sign-in form's. */
export function FunnelHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1 className="text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">{title}</h1>
      {children && <p className="mb-7 mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">{children}</p>}
    </>
  );
}
