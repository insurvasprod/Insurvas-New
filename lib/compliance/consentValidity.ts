/**
 * LA-6.2 / LA-6.3 (Notion sprint, Module 6 — Compliance) · whether a consent artefact covered a
 * contact at a given moment. ONE rule, used by the pre-transfer gate (at the moment of transfer), the
 * evidence report's consent section, and — through its SQL twin compliance_consent_valid_at
 * (20261015630000) — the gap checks. The two are held to one corpus (consentValidity.test.mjs).
 *
 *   1. Consent given after the contact never covered it: a call before the consent's own time is a gap.
 *   2. A retained (claimed) certificate covers every later contact.
 *   3. A pending certificate covers a contact only inside its provider's claim window (LA-2.6,
 *      lib/consent/claimWindow.ts), measured from the consent time, else the capture time. A provider
 *      with no published window is not refused on age.
 *   4. Anything else (expired, failed) covers nothing.
 */

import { PROVIDER_CLAIM_WINDOW_HOURS } from "../consent/claimWindow.ts";

export type ConsentArtefactFacts = {
  capture_status: string;
  provider: string;
  consent_timestamp: string | null;
  captured_at: string;
};

/** When the consent was given: the vendor's consent time, else when we captured the certificate. */
export function consentGivenAt(a: Pick<ConsentArtefactFacts, "consent_timestamp" | "captured_at">): number {
  return Date.parse(a.consent_timestamp ?? a.captured_at);
}

export function consentValidAt(a: ConsentArtefactFacts, at: Date | string, claimHours: Record<string, number | null> = PROVIDER_CLAIM_WINDOW_HOURS): boolean {
  const when = typeof at === "string" ? Date.parse(at) : at.getTime();
  const given = consentGivenAt(a);
  if (!Number.isFinite(given) || !Number.isFinite(when) || given > when) return false;
  if (a.capture_status === "claimed") return true;
  if (a.capture_status !== "pending") return false;
  const hours = claimHours[a.provider];
  if (hours === null || hours === undefined) return true;
  return given + hours * 3_600_000 >= when;
}
