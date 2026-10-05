/**
 * LA-3 application vocabulary, client-safe.
 *
 * The one source for every status, outcome, step and canonical field key the application flow
 * uses. `docs/la3/STATUS-MODEL.md` is the specification; this file is its code. A value that is not
 * here does not exist — the migration CHECKs are generated from the same lists.
 */

import type { StatusTone } from "@/components/ui/status-chip";

// ── attempt status (STATUS-MODEL §2) ─────────────────────────────────────────
export const APPLICATION_STATUSES = ["draft", "ready", "submitted", "pending_carrier", "counteroffer_pending", "closed"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "Draft",
  ready: "Ready to submit",
  submitted: "Submitted",
  pending_carrier: "Pending carrier",
  counteroffer_pending: "Counteroffer",
  closed: "Closed",
};

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  draft: "neutral",
  ready: "action",
  submitted: "info",
  pending_carrier: "warning",
  counteroffer_pending: "warning",
  closed: "neutral",
};

// ── attempt outcome (STATUS-MODEL §3) ────────────────────────────────────────
export const APPLICATION_OUTCOMES = ["issued", "declined", "postponed", "withdrawn", "declined_by_client", "offer_expired"] as const;
export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

export const APPLICATION_OUTCOME_LABEL: Record<ApplicationOutcome, string> = {
  issued: "Issued",
  declined: "Declined",
  postponed: "Postponed",
  withdrawn: "Withdrawn",
  declined_by_client: "Client refused offer",
  offer_expired: "Offer expired",
};

export const APPLICATION_OUTCOME_TONE: Record<ApplicationOutcome, StatusTone> = {
  issued: "good",
  declined: "danger",
  postponed: "warning",
  withdrawn: "neutral",
  declined_by_client: "danger",
  offer_expired: "danger",
};

/** Outcomes that must carry a structured reason (STATUS-MODEL §3). */
export const OUTCOMES_NEEDING_REASON: readonly ApplicationOutcome[] = ["declined", "postponed", "withdrawn"];

export const OUTCOME_REASONS = [
  { code: "medication", label: "Medication disclosed", outcomes: ["declined", "postponed"] },
  { code: "recent_hospitalisation", label: "Recent hospitalisation", outcomes: ["declined", "postponed"] },
  { code: "height_weight", label: "Height / weight (build chart)", outcomes: ["declined"] },
  { code: "prior_decline", label: "Prior decline", outcomes: ["declined"] },
  { code: "banking_nsf", label: "Banking / NSF", outcomes: ["declined", "withdrawn"] },
  { code: "incomplete_application", label: "Incomplete application", outcomes: ["declined"] },
  { code: "replacement_not_disclosed", label: "Replacement not disclosed", outcomes: ["declined"] },
  { code: "client_changed_mind", label: "Client changed their mind", outcomes: ["withdrawn"] },
  { code: "client_unreachable", label: "Client unreachable", outcomes: ["withdrawn"] },
  { code: "other", label: "Other", outcomes: ["declined", "postponed", "withdrawn"] },
] as const satisfies readonly { code: string; label: string; outcomes: readonly ApplicationOutcome[] }[];
export type OutcomeReasonCode = (typeof OUTCOME_REASONS)[number]["code"];

// ── case status (STATUS-MODEL §5) ────────────────────────────────────────────
/** LA-3 writes only these. `submitted`, `closed`, `abandoned` stay valid in the CHECK, unused. */
export const CASE_STATUSES = ["open", "won", "lost"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = { open: "Open", won: "Won", lost: "Lost" };
export const CASE_STATUS_TONE: Record<CaseStatus, StatusTone> = { open: "info", won: "good", lost: "neutral" };

export const INSURED_ROLES = ["primary", "spouse"] as const;
export type InsuredRole = (typeof INSURED_ROLES)[number];

// ── workspace steps (ROUTES §1) ──────────────────────────────────────────────
export const WORKSPACE_STEPS = [
  { key: "verify", label: "Verify" },
  { key: "interview", label: "Interview" },
  { key: "quote", label: "Quote" },
  { key: "application", label: "Application" },
  { key: "beneficiaries", label: "Beneficiaries" },
  { key: "payment", label: "Payment" },
  { key: "disclosures", label: "Disclosures" },
  { key: "review", label: "Review" },
  { key: "submit", label: "Submit" },
  { key: "after", label: "After submit" },
  { key: "timeline", label: "Timeline" },
] as const;
export type WorkspaceStep = (typeof WORKSPACE_STEPS)[number]["key"];

export function isWorkspaceStep(value: string | null | undefined): value is WorkspaceStep {
  return WORKSPACE_STEPS.some((step) => step.key === value);
}

// ── products (codes seeded in 0003_products) ─────────────────────────────────
export const PRODUCT_LABEL: Record<string, string> = {
  final_expense: "Final Expense",
  term_life: "Term Life",
  whole_life: "Whole Life",
  iul: "Indexed Universal Life",
  medicare_advantage: "Medicare Advantage",
  annuity: "Annuity",
};

// ── product tiers ────────────────────────────────────────────────────────────
export const FE_TIERS = ["level", "graded", "modified", "gi"] as const;
export type FeTier = (typeof FE_TIERS)[number];
export const TIER_LABEL: Record<string, string> = { level: "Level", graded: "Graded", modified: "Modified", gi: "Guaranteed issue" };

// ── payment methods (LA-3.19) ────────────────────────────────────────────────
export const PAYMENT_METHODS = ["ach", "direct_express", "debit_card", "credit_card", "direct_bill"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ach: "Bank draft (ACH)",
  direct_express: "Direct Express card",
  debit_card: "Debit card",
  credit_card: "Credit card",
  direct_bill: "Direct bill",
};

// ── canonical field keys (LA-3.7) ────────────────────────────────────────────
export type FieldInput = "text" | "date" | "select" | "number" | "tel" | "email" | "boolean" | "money" | "ssn" | "state";

export type CanonicalField = {
  key: string;
  label: string;
  input: FieldInput;
  options?: readonly { value: string; label: string }[];
  sensitive?: boolean;
  /** Shared across a household by default (LA-3.24). Health keys never are. */
  household?: boolean;
};

export type CanonicalGroup = { key: string; label: string; fields: readonly CanonicalField[] };

const GENDER = [{ value: "female", label: "Female" }, { value: "male", label: "Male" }] as const;
const YES_NO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] as const;

export const CANONICAL_GROUPS: readonly CanonicalGroup[] = [
  {
    key: "insured",
    label: "Proposed insured",
    fields: [
      { key: "insured.first_name", label: "First name", input: "text" },
      { key: "insured.middle_initial", label: "Middle initial", input: "text" },
      { key: "insured.last_name", label: "Last name", input: "text" },
      { key: "insured.dob", label: "Date of birth", input: "date" },
      { key: "insured.gender", label: "Gender", input: "select", options: GENDER },
      { key: "insured.ssn", label: "Social Security number", input: "ssn", sensitive: true },
      { key: "insured.birth_state", label: "Birth state", input: "state" },
      { key: "insured.height_in", label: "Height (inches)", input: "number" },
      { key: "insured.weight_lb", label: "Weight (lb)", input: "number" },
      { key: "insured.tobacco", label: "Tobacco in the last 12 months", input: "select", options: YES_NO },
    ],
  },
  {
    key: "contact",
    label: "Contact",
    fields: [
      { key: "contact.phone", label: "Phone", input: "tel", household: true },
      { key: "contact.email", label: "Email", input: "email", household: true },
    ],
  },
  {
    key: "addr",
    label: "Address",
    fields: [
      { key: "addr.line1", label: "Street address", input: "text", household: true },
      { key: "addr.line2", label: "Apartment, unit", input: "text", household: true },
      { key: "addr.city", label: "City", input: "text", household: true },
      { key: "addr.state", label: "State", input: "state", household: true },
      { key: "addr.zip", label: "ZIP", input: "text", household: true },
      { key: "addr.years_at", label: "Years at address", input: "number", household: true },
    ],
  },
  {
    key: "owner",
    label: "Policy owner",
    fields: [
      { key: "owner.same_as_insured", label: "Owner is the insured", input: "boolean" },
      { key: "owner.first_name", label: "Owner first name", input: "text" },
      { key: "owner.last_name", label: "Owner last name", input: "text" },
      { key: "owner.dob", label: "Owner date of birth", input: "date" },
      { key: "owner.relationship", label: "Relationship to insured", input: "text" },
    ],
  },
  {
    key: "cov",
    label: "Coverage",
    fields: [
      { key: "cov.face_amount", label: "Face amount", input: "money" },
      { key: "cov.product_tier", label: "Benefit type", input: "select", options: FE_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] })) },
      { key: "cov.monthly_premium", label: "Monthly premium", input: "money" },
      // Typed by the agent (the one coverage value the quote does not carry).
      { key: "cov.effective_date", label: "Effective date", input: "date" },
    ],
  },
];

/** Canonical keys for the typed payment record, so field maps and copy-assist can name them. */
export const PAYMENT_FIELD_KEYS = [
  "pay.method", "pay.routing_number", "pay.account_number", "pay.account_type", "pay.bank_name",
  "pay.name_on_account", "pay.card_number", "pay.card_exp", "pay.card_brand", "pay.name_on_card",
  "pay.billing_frequency", "pay.draft_day",
] as const;

/** Never in a list payload, never in an AI payload, never in a bulk extension payload. */
export const SENSITIVE_FIELD_KEYS = ["insured.ssn", "pay.routing_number", "pay.account_number", "pay.card_number"] as const;
export type SensitiveFieldKey = (typeof SENSITIVE_FIELD_KEYS)[number];
export function isSensitiveKey(key: string): key is SensitiveFieldKey {
  return (SENSITIVE_FIELD_KEYS as readonly string[]).includes(key);
}

export const VALUE_SOURCES = ["lead", "interview", "quote", "manual", "carried_forward", "household"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];
export const VALUE_SOURCE_LABEL: Record<ValueSource, string> = {
  lead: "From the lead",
  interview: "From the interview",
  quote: "From the quote",
  manual: "Typed here",
  carried_forward: "From the last attempt",
  household: "Shared with spouse",
};

// ── beneficiaries (LA-3.8) ───────────────────────────────────────────────────
export const BENEFICIARY_RELATIONSHIPS = ["spouse", "child", "parent", "sibling", "grandchild", "estate", "trust", "funeral_home", "other"] as const;
export type BeneficiaryRelationship = (typeof BENEFICIARY_RELATIONSHIPS)[number];
export const BENEFICIARY_RELATIONSHIP_LABEL: Record<BeneficiaryRelationship, string> = {
  spouse: "Spouse", child: "Child", parent: "Parent", sibling: "Sibling", grandchild: "Grandchild",
  estate: "Estate", trust: "Trust", funeral_home: "Funeral home", other: "Other",
};

// ── requirements (LA-3.18) ───────────────────────────────────────────────────
export const REQUIREMENT_KINDS = ["aps", "phone_interview", "voice_verification", "missing_info", "amendment", "paramed_exam", "counteroffer", "other"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  aps: "Physician statement (APS)",
  phone_interview: "Phone health interview",
  voice_verification: "Voice verification",
  missing_info: "Missing information",
  amendment: "Amendment to sign",
  paramed_exam: "Paramed exam",
  counteroffer: "Counteroffer response",
  other: "Other",
};
export const WAITING_ON = ["client", "carrier", "agent", "third_party"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];
export const WAITING_ON_LABEL: Record<WaitingOn, string> = { client: "Client", carrier: "Carrier", agent: "You", third_party: "Third party" };
export const WAITING_ON_TONE: Record<WaitingOn, StatusTone> = { client: "action", carrier: "info", agent: "warning", third_party: "neutral" };

// ── draft-date income types (LA-3.9) ─────────────────────────────────────────
export const INCOME_TYPES = ["ssa", "ssi", "ssa_ssi", "pension", "payroll", "va", "none"] as const;
export type IncomeType = (typeof INCOME_TYPES)[number];
export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  ssa: "Social Security / SSDI",
  ssi: "SSI",
  ssa_ssi: "Social Security and SSI",
  pension: "Pension",
  payroll: "Paycheck",
  va: "VA benefits",
  none: "None / not known",
};
