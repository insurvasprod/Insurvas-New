import { ViewTransition, type ReactNode } from "react";
import Link from "next/link";

import { LandingObject } from "@/components/marketing/three/landing-object";

export type PortalAuthMode = "sign-in" | "sign-up";

/**
 * The one sign-in / sign-up frame for the agent and partner portals (2026-10-13).
 *
 * The brand panel carries the landing hero's silk ribbon, so arriving from the landing page reads
 * as the same scene coming closer rather than a new page: the ribbon is a named view transition
 * ("brand-ribbon") on both pages and morphs from the hero into this panel, the logo does the same
 * ("brand-logo", see AuthBrand), and the form and the panel's words crossfade between doors
 * (agent ↔ partner, sign-in ↔ sign-up). Without View Transitions support it simply navigates; under
 * reduced motion the CSS in globals.css turns every one of these off.
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
        <ViewTransition name="brand-ribbon" share="ribbon-morph" default="none">
          <LandingObject
            kind="ribbon-night"
            className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(120%_85%_at_70%_45%,black_45%,transparent_100%)]"
          />
        </ViewTransition>
        <div aria-hidden="true" className="portal-auth-story-veil" />
        <ViewTransition name="auth-story" share="auth-swap" enter="auth-rise" exit="auth-fade" update="auth-swap" default="none">
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
      <Link href={href} className="mb-10 inline-flex items-center gap-2.5 no-underline" aria-label={label}>
        {children}
      </Link>
    </ViewTransition>
  );
}
