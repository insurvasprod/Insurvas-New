// The face amount the Quote step starts from. Pure and client-safe.
//
// Walk 2026-11-20: a Term Life lead asking for $250,000 opened the Quote step with the face blank.
// The application's own `cov.face_amount` (set by a selected quote, or typed) wins; failing that,
// what the lead asked for. Both are in cents, so nothing is converted here.

import { faceAmountCents } from "../appointments/appointmentFacts.ts";

const positiveCents = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;

export function initialFaceCents(applicationFace: unknown, requestedFaceCents: number | null | undefined): { cents: number | null; fromLead: boolean } {
  const own = positiveCents(applicationFace);
  if (own !== null) return { cents: own, fromLead: false };
  const asked = positiveCents(requestedFaceCents);
  return asked !== null ? { cents: asked, fromLead: true } : { cents: null, fromLead: false };
}


/**
 * What the lead asked for, in cents. A field the lead's form types as `currency` already holds cents (the partner
 * portal stores dollars × 100, as every agent screen reads it); anything else goes through faceAmountCents, which
 * reads `face_amount` / `coverage_amount` as whole dollars (an imported column) and the `_cents` keys as cents.
 * Manager walk 2026-11-20: a $300,000 partner lead opened the Quote step at $30,000,000.
 */
export function leadFaceCents(values: Record<string, unknown> | null | undefined, currencyKeys: ReadonlySet<string>): number | null {
  if (!values) return null;
  for (const key of ["face_amount", "coverage_amount"]) {
    const raw = values[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(/[$,\s]/g, "")) : NaN;
    if (currencyKeys.has(key) && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return faceAmountCents(values);
}
