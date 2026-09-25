// The vocabulary the TCPA screen and the exemption / screening-audit services share. No
// `server-only` here, so the client components can import values from it (see constants.ts).

/** LA-2.3-3: the two bases an owner may record, per the user's decision of 2026-09-25. */
export type DncExemptionBasis = "written_consent" | "existing_business_relationship";
export type RelationshipKind = "purchase" | "inquiry";

export const DNC_EXEMPTION_BASIS_LABELS: Record<DncExemptionBasis, string> = {
  written_consent: "Written consent",
  existing_business_relationship: "Existing business relationship",
};

export const RELATIONSHIP_KIND_LABELS: Record<RelationshipKind, string> = {
  purchase: "Purchase or transaction",
  inquiry: "Inquiry or application",
};

/** Months an existing business relationship lasts, from its date (the TSR windows). */
export const RELATIONSHIP_MONTHS: Record<RelationshipKind, number> = { purchase: 18, inquiry: 3 };

/** The expiry the database will compute, for the form to show before saving. UTC dates. */
export function relationshipExpiry(kind: RelationshipKind, isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + RELATIONSHIP_MONTHS[kind], Number(match[3])));
  // Postgres date + interval clamps to the month's last day (31 Aug + 3 months = 30 Nov). JS rolls
  // over into the next month instead, so step back to the last day of the intended month.
  const intendedMonth = (Number(match[2]) - 1 + RELATIONSHIP_MONTHS[kind]) % 12;
  if (date.getUTCMonth() !== intendedMonth) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export const EXEMPTION_USE_LABELS: Record<string, string> = {
  dial_gate: "Dialer check",
  dial: "Dial, live registry lookup",
  dial_preflight: "Check a number",
  lead_post: "Real-time post",
};

export const CLEARED_LIST_LABELS: Record<string, string> = {
  federal_dnc: "Federal DNC",
  state_dnc: "State DNC",
  dnc_registry: "DNC registry (live)",
};

export type DncExemption = {
  id: string;
  phoneDigits: string;
  basis: DncExemptionBasis;
  relationshipKind: RelationshipKind | null;
  relationshipDate: string | null;
  expiresAt: string | null;
  certificateProvider: string | null;
  certificateUrl: string | null;
  consentArtefactId: string | null;
  note: string | null;
  recordedAt: string;
  recordedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
  /** active | expired | revoked | certificate_gone, as the gates see it right now. */
  state: "active" | "expired" | "revoked" | "certificate_gone";
  uses: number;
  lastUsedAt: string | null;
};

export type DncExemptionUse = {
  id: string;
  exemptionId: string;
  phoneDigits: string;
  context: string;
  clearedLists: string[];
  leadId: string | null;
  userName: string | null;
  usedAt: string;
};

export type ConsentCertificateOption = {
  id: string;
  leadId: string;
  leadName: string | null;
  provider: string;
  certificateUrl: string | null;
  capturedAt: string | null;
  status: string;
  /** Claimed and the copy held: the only kind a written-consent exemption may attach. */
  stored: boolean;
};

/** LA-2.3-9: one screening check, as /app/tcpa lists it. */
export type ScreeningAuditRow = {
  id: string;
  at: string;
  phoneDigits: string | null;
  outcome: string;
  vendor: string | null;
  cached: boolean;
  who: string;
  /** Where the check came from, read from the row (a partner, the dial preflight, a user, a post). */
  origin: string;
  leadId: string | null;
  leadName: string | null;
  rawResponse: unknown;
};

export const SCREENING_OUTCOME_LABELS: Record<string, string> = {
  clear: "Clear",
  dnc: "DNC listed",
  internal_dq: "Already a lead",
  tcpa_litigator: "TCPA litigator",
  invalid_phone: "Invalid number",
  unavailable: "Could not be checked",
};
