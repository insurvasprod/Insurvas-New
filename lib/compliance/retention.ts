/**
 * LA-6.6 (Notion sprint, Module 6 — Compliance) · retention: the record types, actions and bases, in
 * words. Pure. The engine is retention_execute (20261015150000).
 *
 * The shipped numbers are a starting point, with basis "our policy" — not legal advice. Every screen
 * that shows them says so.
 */

export const RECORD_TYPES = [
  { key: "consent_artefacts", label: "Consent artefacts" },
  { key: "call_attempt_logs", label: "Call attempt logs" },
  { key: "scrub_screening_results", label: "Scrub and screening results" },
  { key: "transfer_verdicts", label: "Transfer verdicts" },
  { key: "internal_dnc", label: "Internal do-not-call entries" },
  { key: "lead_data_unconverted", label: "Lead data, never converted" },
  { key: "nurture_winback_candidates", label: "Nurture and win-back candidates" },
  { key: "complaint_records", label: "Complaint records" },
  { key: "policy_commission_records", label: "Policy and commission records" },
  { key: "compliance_evidence_reports", label: "Compliance evidence reports" },
] as const;
export type RecordType = (typeof RECORD_TYPES)[number]["key"];
export const RECORD_TYPE_KEYS: readonly RecordType[] = RECORD_TYPES.map((r) => r.key);
export const RECORD_TYPE_LABELS = Object.fromEntries(RECORD_TYPES.map((r) => [r.key, r.label])) as Record<RecordType, string>;

export const ACTIONS = ["purge", "anonymise", "never_delete"] as const;
export type RetentionAction = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<RetentionAction, string> = { purge: "Delete", anonymise: "Anonymise, keep", never_delete: "Never delete" };

export const BASES = ["statute", "carrier_requirement", "our_policy", "legal_advice"] as const;
export type RetentionBasis = (typeof BASES)[number];
export const BASIS_LABELS: Record<RetentionBasis, string> = { statute: "Statute", carrier_requirement: "Carrier requirement", our_policy: "Our policy", legal_advice: "Legal advice" };

export const HOLD_SCOPES = ["phone_digits", "contact_id", "policy_number", "tenant_wide"] as const;
export type HoldScope = (typeof HOLD_SCOPES)[number];
export const HOLD_SCOPE_LABELS: Record<HoldScope, string> = { phone_digits: "A phone number", contact_id: "A client", policy_number: "A policy number", tenant_wide: "Everything (whole agency)" };
export const HOLD_REASONS = ["complaint", "litigation", "regulator_inquiry", "commission_dispute", "manual"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const HOLD_REASON_LABELS: Record<HoldReason, string> = { complaint: "Open complaint", litigation: "Litigation", regulator_inquiry: "Regulator inquiry", commission_dispute: "Commission dispute", manual: "Placed by hand" };
/** Placed and released by the system's own sources; a person can only place the others. */
export const AUTOMATIC_REASONS: readonly HoldReason[] = ["complaint", "commission_dispute"];

export const NOT_LEGAL_ADVICE = "The shipped retention periods are a starting point, not legal advice. Set your own per state with your counsel.";

/** "1,461 days (about 4 years)". */
export function describeDays(days: number | null): string {
  if (days === null) return "Forever";
  const years = days / 365.25;
  const human = years >= 1 ? `about ${Math.round(years * 10) / 10} year${Math.round(years) === 1 ? "" : "s"}` : `about ${Math.round(days / 30)} months`;
  return `${days.toLocaleString("en-US")} days (${human})`;
}

export type RuleRow = { id: string; tenantId: string | null; recordType: string; state: string | null; retainDays: number | null; action: string; basis: string; notes: string | null; setAt: string };

/** The rule a record type resolves to for a state: tenant + state, tenant + all, platform + state, platform default. Null = unruled (no purge). */
export function resolveRule(rules: RuleRow[], tenantId: string, recordType: string, state: string | null): RuleRow | null {
  const mine = rules.filter((r) => r.recordType === recordType);
  const pick = (tenant: string | null, st: string | null) => mine.find((r) => r.tenantId === tenant && r.state === st) ?? null;
  return (state ? pick(tenantId, state) : null) ?? pick(tenantId, null) ?? (state ? pick(null, state) : null) ?? pick(null, null);
}
