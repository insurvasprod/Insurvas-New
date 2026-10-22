"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check, LockKeyhole, X } from "lucide-react";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { AuthBrand, PortalAuthSplitShell } from "@/components/portal/portal-auth-split-shell";

/**
 * The partner doors' frame (2026-10-13): sign-in, accepting an invitation and setting a first
 * password all sit in the same split frame as the agent and staff sign-ins — the form on one side
 * with the logo and the legal links, and the brand panel with the night ribbon on the other, saying
 * what a partner can and cannot see.
 */

/**
 * What this door lets you see, and what it does not.
 *
 * The denials are the point: a partner who can read the boundary before signing in never files a
 * ticket asking why another organisation's leads are missing.
 */
const BOUNDARY = [
  { label: "Leads your organisation submitted", allowed: true },
  { label: "Their stage, and who moved them", allowed: true },
  { label: "Your channel with the agency", allowed: true },
  { label: "Another partner’s leads or messages", allowed: false },
  { label: "Agent-internal notes and lead cost", allowed: false },
];

/**
 * Cards drawn inside the frame lose their own box (border, panel, padding): the frame's form column
 * is the surface, as on the sign-in form.
 */
export const PARTNER_FLAT_CARD =
  "w-full gap-4 border-0 bg-transparent py-0 shadow-none [&>[data-slot=card-content]]:px-0 [&>[data-slot=card-header]]:px-0";

function PartnerAuthStory() {
  return (
    <div className="m-stagger mx-auto w-full max-w-[38rem]">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-[var(--nav-muted)]">
        Partner portal
      </div>
      <h2 className="mt-3.5 max-w-[520px] text-headline-lg font-semibold leading-[1.0] tracking-[-0.045em] text-[var(--on-dark)] lg:text-[clamp(2.75rem,4.2vw,3.75rem)]">
        Submit, track and coordinate.
      </h2>
      <div className="mt-8 max-w-[460px] rounded-xl border border-[var(--nav-line)] bg-[color-mix(in_srgb,var(--nav-bg)_62%,transparent)] p-6 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <LockKeyhole className="size-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
          <span className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-[var(--on-dark)]">Your organisation only</span>
        </div>
        <div className="mt-4">
          {BOUNDARY.map((item) => (
            <div key={item.label} className="flex gap-2.5 py-1.5">
              {item.allowed ? (
                <Check className="size-[13px] shrink-0 translate-y-1 stroke-[3] text-[var(--nav-success)]" aria-hidden="true" />
              ) : (
                <X className="size-[13px] shrink-0 translate-y-1 stroke-[3] text-[var(--nav-muted)]" aria-hidden="true" />
              )}
              <span className={`text-sm leading-normal tracking-[-0.02em] ${item.allowed ? "text-[var(--nav-ink)]" : "text-[var(--nav-muted)]"}`}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PartnerAuthFrame({ children }: { children: ReactNode }) {
  return (
    <PortalAuthSplitShell
      mode="sign-in"
      className="portal-partner portal-tenant-auth-shell"
      form={
        <div className="m-stagger portal-auth-form-inner">
          <AuthBrand href="/" label="Insurvas home">
            <InsurvasLogo size="auth" />
          </AuthBrand>
          {children}
          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      }
      story={<PartnerAuthStory />}
    />
  );
}
