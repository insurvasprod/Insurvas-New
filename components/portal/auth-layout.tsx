import type { ReactNode } from "react";
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
  children: ReactNode;
}) {
  return (
    <PortalAuthSplitShell
      mode={mode}
      className={PLANE_CLASS[plane]}
      form={
        <div className="m-stagger portal-auth-form-inner" data-width={width} style={width === "wide" ? { maxWidth: 720 } : undefined}>
          <AuthBrand href="/" label="Insurvas home">
            <InsurvasLogo size="auth" />
          </AuthBrand>
          {steps && <AuthSteps {...steps} />}
          {back && <AuthBack href={back.href} label={back.label} />}
          {children}
          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      }
      story={story}
    />
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
};

/** "Step 2 of 5 · Your email" over one bar per step. One stepper, so no screen counts differently. */
export function AuthSteps({ current, total, label, labels, ariaLabel = "Progress" }: AuthStepsProps) {
  const done = current > total;
  return (
    <div data-auth-steps="" className="mb-6">
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
    <div className="m-stagger mx-auto w-full max-w-[38rem]">
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
