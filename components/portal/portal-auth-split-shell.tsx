import { ViewTransition, type ReactNode } from "react";
import Link from "next/link";

export type PortalAuthMode = "sign-in" | "sign-up";

/**
 * The one sign-in / sign-up frame for the agent and partner portals (2026-10-13).
 *
 * The brand panel is still: the brand green with one soft light, no ribbon (owner, 2026-10-27:
 * "remove this animation … simple professional design on the right"). The logo is still a named
 * view transition ("brand-logo", see AuthBrand), and the form and the panel's words crossfade
 * between doors (agent ↔ partner, sign-in ↔ sign-up). Without View Transitions support it simply
 * navigates; under reduced motion the CSS in globals.css turns these off.
 */
export function PortalAuthSplitShell({
  mode,
  form,
  story,
  className = "",
}: {
  mode: PortalAuthMode;
  form: ReactNode;
  story: ReactNode;
  className?: string;
}) {
  return (
    <div className={`portal-auth-split-shell ${className}`.trim()} data-mode={mode}>
      <section className="portal-auth-split-form" aria-label={mode === "sign-in" ? "Sign in" : "Create an account"}>
        <ViewTransition name="auth-form" share="auth-swap" enter="auth-rise" exit="auth-fade" update="auth-swap" default="none">
          <div className="flex w-full flex-1 flex-col items-center justify-center">{form}</div>
        </ViewTransition>
      </section>
      <aside className="portal-auth-split-story portal-auth-story-scene" aria-label="Insurvas workspace benefits">
        {/* A soft crossfade only: the panel does not rise or blink between steps (2026-10-28). */}
        <ViewTransition name="auth-story" share="auth-hold" enter="auth-rise" exit="auth-fade" update="auth-hold" default="none">
          <div className="relative z-10 w-full">{story}</div>
        </ViewTransition>
      </aside>
    </div>
  );
}

/** The logo at the top of a sign-in form: the same named element as the site header's logo. */
export function AuthBrand({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <ViewTransition name="brand-logo" share="ribbon-morph" default="none">
      <Link href={href} className="mb-8 inline-flex items-center gap-2.5 no-underline" aria-label={label}>
        {children}
      </Link>
    </ViewTransition>
  );
}
