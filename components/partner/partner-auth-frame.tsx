"use client";

import type { ReactNode } from "react";

import { AuthLayout, AuthStory } from "@/components/portal/auth-layout";
import { AuthShowcase } from "@/components/app/auth-showcase";

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

/** The partner door's panel, in the one AuthStory style: what a partner can and cannot see. */
function PartnerAuthStory() {
  return (
    <AuthStory
      label="Partner portal"
      title="Submit, track and coordinate."
      rowsTitle="Your organisation only"
      rows={BOUNDARY.map((item) => ({ label: item.label, state: item.allowed ? "yes" : "no" }))}
    />
  );
}

export function PartnerAuthFrame({ children, animated = false }: { children: ReactNode; animated?: boolean }) {
  return (
    <AuthLayout plane="partner" story={animated ? <AuthShowcase step={0} /> : <PartnerAuthStory />}>
      {children}
    </AuthLayout>
  );
}
