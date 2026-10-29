import { ViewTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { AuthBrand, PortalAuthSplitShell, type PortalAuthMode } from "@/components/portal/portal-auth-split-shell";

/**
 * The one layout behind every sign-in and sign-up screen (UI-CONSISTENCY.md §13, foundation v3):
 * agent sign-in and its reset, 2FA and link states, the five sign-up steps and the welcome screen,
 * the account screens, the partner doors and staff sign-in.
 *
 * Before this, they shared the split shell but drew their own heading, stepper, alerts and brand
 * panel, so no two looked alike. Now the column is always, top to bottom: logo, steps, back link,
 * the screen's own content (opening with <AuthHeading>), legal links — and the panel is always an
 * <AuthStory>, or real content (the plan summary, the receipt) passed as `aside`.
 *
 * It is the only component that renders PortalAuthSplitShell (lib/design/authShell.test.mjs).
 */

export type AuthPlane = "agent" | "partner" | "admin";

const PLANE_CLASS: Record<AuthPlane, string> = {
  agent: "portal-agent portal-tenant-auth-shell",
  partner: "portal-partner portal-tenant-auth-shell",
  admin: "portal-tenant-auth-shell",
};

export function AuthLayout({
  plane,
  mode = "sign-in",
  width = "default",
  steps,
  back,
  story,
  align,
  legal = true,
  children,
}: {
  plane: AuthPlane;
  /** Which door this is, for the crossfade between sign-in and sign-up. */
  mode?: PortalAuthMode;
  /** "wide" (720px) only for a grid of choices or a document: Your agency, Your plan, Payment, terms. */
  width?: "default" | "wide";
  steps?: AuthStepsProps;
  /** "← Back to …" above the heading. */
  back?: { href: string; label: string };
  /** The brand panel: an <AuthStory>, or real content such as the plan summary or the receipt. */
  story: ReactNode;
  /**
   * "center" (the default): the logo stays at the top and the rest sits in the middle of the space
   * below it (owner, 2026-10-27: sign-in looked unfinished with the form at the top; then "all of
   * them in the center", the sign-up steps too). "top" is kept for a screen that needs it.
   */
  align?: "top" | "center";
  /**
   * The Privacy · Terms · Support line under the form. Payment turns it off and shows the same links
   * in its summary instead (owner, 2026-10-28): Whop's form is as tall as it is, and this line was
   * what still pushed the page past an 826px window.
   */
  legal?: boolean;
  children: ReactNode;
}) {
  return (
    <PortalAuthSplitShell
      mode={mode}
      className={PLANE_CLASS[plane]}
      form={
        <div className="portal-auth-form-inner" data-width={width} data-align={align ?? "center"} style={width === "wide" ? { maxWidth: 720 } : undefined}>
          {/* flex, so the inline logo link adds no line-height gap under it. */}
          <div className="m-stagger flex" data-auth-logo="">
            <AuthBrand href="/" label="Insurvas home">
              <InsurvasLogo size="auth" />
            </AuthBrand>
          </div>
          {/* Auto margins, not justify-content: a door taller than the window starts at the top
              instead of being cut off above it. */}
          <div className="m-stagger" data-auth-body="">
            {/* Step to step (manager review, 2026-10-28: "from this page to next page should be smooth"):
                the progress bar stays where it is and only the step's own content moves, a quick fade
                out and a short rise in. Classes in globals.css (auth-still, auth-step). */}
            {steps && (
              <ViewTransition name="auth-steps" share="auth-still" default="none">
                <div><AuthSteps {...steps} /></div>
              </ViewTransition>
            )}
            <ViewTransition name="auth-step-body" share="auth-step" enter="auth-rise" exit="auth-fade" default="none">
              <div>
                {back && <AuthBack href={back.href} label={back.label} />}
                {children}
                {legal && <AuthLegalLinks />}
              </div>
            </ViewTransition>
          </div>
        </div>
      }
      story={story}
    />
  );
}

/** Privacy · Terms · Support, the line under every auth form (and in the payment summary). */
export function AuthLegalLinks({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    // Inline colour on the green panel: .portal-login-footer's own colour outranks a utility class.
    <nav className={cn("portal-login-footer", className)} style={onDark ? { color: "var(--nav-muted)" } : undefined} aria-label="Legal links">
      <Link href="/legal/privacy">Privacy</Link>
      <Link href="/legal/tos">Terms</Link>
      <a href="mailto:support@insurvas.com">Support</a>
    </nav>
  );
}

/* ── Steps ──────────────────────────────────────────────────────────────────────────────────── */

export type AuthStepsProps = {
  /** 1-based. Above `total` reads as every step done. */
  current: number;
  total: number;
  /** The current step's name: "Your email". */
  label?: string;
  /** Names every bar for screen readers. */
  labels?: readonly string[];
  /** "Sign-up progress", "Sign-in steps". */
  ariaLabel?: string;
  /** A short link on the right of the step line ("Have an account? Sign in" on step 1). */
  aside?: ReactNode;
};

/** "Step 1 of 3 · Your account" over one bar per step. One stepper, so no screen counts differently. */
export function AuthSteps({ current, total, label, labels, ariaLabel = "Progress", aside }: AuthStepsProps) {
  const done = current > total;
  return (
    <div data-auth-steps="" className="mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-muted-foreground">
        {done ? (
          <span className="text-foreground">All {total} steps done</span>
        ) : (
          <>
            <span className="text-foreground">Step {current} of {total}</span>
            {label && <> · {label}</>}
          </>
        )}
      </p>
        {aside && <span className="text-sm text-muted-foreground">{aside}</span>}
      </div>
      <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-label={ariaLabel}>
        {Array.from({ length: total }, (_, index) => {
          const name = labels?.[index] ?? `Step ${index + 1}`;
          return (
            <li
              key={name}
              className={cn("h-1 rounded-full transition-colors duration-300", index < current ? "bg-[var(--primary)]" : "bg-border")}
              aria-current={index + 1 === current ? "step" : undefined}
            >
              <span className="sr-only">{name}{index + 1 < current ? ", done" : index + 1 === current ? ", current step" : ""}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── Back ───────────────────────────────────────────────────────────────────────────────────── */

/** A real link to the previous step, above the heading. */
export function AuthBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      data-auth-back=""
      data-tap=""
      className="mb-5 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

/* ── Heading ────────────────────────────────────────────────────────────────────────────────── */

/** Every auth screen opens with this: the display face, left-aligned, at most one line under it. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div data-auth-heading="" className="mb-6">
      <h1 className="font-[family-name:var(--font-display)] text-title-lg font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-headline-lg">
        {title}
      </h1>
      {children && <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">{children}</p>}
    </div>
  );
}

/* ── Story ──────────────────────────────────────────────────────────────────────────────────── */

export type AuthStoryRow = {
  label: ReactNode;
  /** A short figure or word on the right: "One claim". */
  value?: ReactNode;
  /** What this door does or does not let you see, drawn as a mark plus the word — never colour alone. */
  state?: "yes" | "no";
  /** One quieter line under the label. */
  detail?: ReactNode;
};

/**
 * The brand panel, in one style for every door: a small label, the large title, and rows with a
 * hairline above each. The words belong to each door; the shape is shared.
 */
export function AuthStory({ label, title, rowsTitle, rows }: { label?: string; title: string; rowsTitle?: string; rows: AuthStoryRow[] }) {
  return (
    // lg:pl-10 / 2xl:pl-[5.25rem]: the rows are narrower than the block, so a centred block read as sitting left; this
    // centres the text in the green half at 1366 and at 1536 wide (owner, 2026-10-28: "more in the middle").
    <div className="m-stagger mx-auto w-full max-w-[38rem] lg:pl-10 2xl:pl-[5.25rem]">
      {label && <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">{label}</div>}
      <h2 className={cn("max-w-[520px] font-[family-name:var(--font-display)] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--on-dark)] lg:text-[clamp(2.75rem,4.2vw,3.75rem)]", label && "mt-3.5")}>
        {title}
      </h2>
      <div className="mt-8 max-w-[460px]">
        {rowsTitle && <p className="mb-2 text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--on-dark)]">{rowsTitle}</p>}
        {rows.map((row, index) => (
          <div key={index} className="flex items-center justify-between gap-4 border-t border-[var(--nav-line)] py-3">
            <span className="min-w-0">
              <span className={cn("flex items-center gap-2.5 text-sm leading-normal tracking-[-0.02em]", row.state === "no" ? "text-[var(--nav-muted)]" : "text-[var(--nav-ink)]")}>
                {row.state === "yes" && <Check className="size-[13px] shrink-0 stroke-[3] text-[var(--nav-success)]" aria-hidden="true" />}
                {row.state === "no" && <X className="size-[13px] shrink-0 stroke-[3] text-[var(--nav-muted)]" aria-hidden="true" />}
                <span>{row.label}</span>
              </span>
              {row.detail && <span className="mt-0.5 block text-sm leading-normal tracking-[-0.02em] text-[var(--nav-muted)]">{row.detail}</span>}
            </span>
            {row.state ? (
              <span className={cn("shrink-0 text-sm font-semibold", row.state === "yes" ? "text-[var(--on-dark)]" : "text-[var(--nav-muted)]")}>
                {row.state === "yes" ? "Visible" : "Hidden"}
              </span>
            ) : (
              row.value && <span className="shrink-0 text-lg font-semibold leading-[1.28] tracking-[-0.015em] tabular-nums text-[var(--on-dark)]">{row.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
