/**
 * DESIGN FIXTURES — LA-3 Design phase only (Settings › Sales).
 *
 * Sample data for the LA-3.17 "Sales" settings panels, so their designs can be reviewed before the
 * schema lands. Every panel that imports this file shows the "Sample data" notice, and nothing it
 * does is saved. The Build phase replaces each import with a fetch; no server route may import it.
 * Carriers' portal origins, usernames, policy-number patterns and descriptors are invented.
 *
 * The shapes are local to this file (the shared view models in `./types` do not cover settings).
 */

import { CANONICAL_GROUPS, type FeTier, type PaymentMethod } from "./constants";
import { FIXTURE_ATTEMPT, FIXTURE_CASE } from "./fixtures";
import type { InterviewQuestion } from "./types";

const now = Date.now();
const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString();

// ── carriers & products (LA-3.17, LA-3.22) ───────────────────────────────────

export type AppointmentState = "appointed" | "pending" | "not_appointed";
export type FieldMapStatus = "none" | "draft" | "published" | "needs_review";

export type SalesProduct = {
  id: string;
  name: string;
  tiers: FeTier[];
  issueAgeMin: number;
  issueAgeMax: number;
  faceMinCents: number;
  faceMaxCents: number;
  /** Year-one commission at the agency's level, whole percent. */
  firstYearCommissionPct: number;
  paymentMethods: PaymentMethod[];
  /** Monthly premium per $1,000 of face that looks plausible for this product (LA-3.5). */
  per1000Min: number;
  per1000Max: number;
};

export type SalesCarrier = {
  id: string;
  name: string;
  /** The carrier portal's origin — also one entry in the extension's host allowlist (LA-3.12). */
  portalOrigin: string;
  /** Regex a policy or application number must match (LA-3.14). */
  policyNumberPattern: string;
  policyNumberExample: string;
  /** What appears on the client's bank statement — the welcome pack quotes it (LA-3.20). */
  billingDescriptor: string;
  appointment: AppointmentState;
  /** The agency's portal login name. Never a password (LA-3.22). */
  portalUsername: string | null;
  portalVerifiedDaysAgo: number | null;
  /** True when the carrier has its own application field set; false uses the platform set. */
  ownFieldSet: boolean;
  fieldMap: FieldMapStatus;
  /** An Insurvas library row the agency has not copied: read-only until copied. */
  platform: boolean;
  products: SalesProduct[];
};

export const PORTAL_STALE_DAYS = 90;

export const SALES_CARRIERS: SalesCarrier[] = [
  {
    id: "car-mutual", name: "Mutual of Omaha", portalOrigin: "https://producer.example-mutual.test",
    policyNumberPattern: "^MO-\\d{8}$", policyNumberExample: "MO-88213401", billingDescriptor: "MUTUAL OF OMAHA INS",
    appointment: "appointed", portalUsername: "rmason", portalVerifiedDaysAgo: 34, ownFieldSet: true, fieldMap: "published", platform: false,
    products: [
      { id: "p-mo-lp", name: "Living Promise", tiers: ["level", "graded"], issueAgeMin: 45, issueAgeMax: 85, faceMinCents: 200_000, faceMaxCents: 5_000_000, firstYearCommissionPct: 105, paymentMethods: ["ach", "direct_express", "debit_card", "credit_card", "direct_bill"], per1000Min: 2.1, per1000Max: 14.8 },
      { id: "p-mo-gi", name: "Guaranteed Whole Life", tiers: ["gi"], issueAgeMin: 50, issueAgeMax: 75, faceMinCents: 200_000, faceMaxCents: 2_500_000, firstYearCommissionPct: 80, paymentMethods: ["ach", "direct_express", "direct_bill"], per1000Min: 4.5, per1000Max: 15 },
    ],
  },
  {
    id: "car-aetna", name: "Aetna", portalOrigin: "https://agents.example-aetna.test",
    policyNumberPattern: "^AE-\\d{7}$", policyNumberExample: "AE-5508123", billingDescriptor: "AETNA LIFE INS PREM",
    appointment: "appointed", portalUsername: "rmason.agent", portalVerifiedDaysAgo: 121, ownFieldSet: false, fieldMap: "needs_review", platform: false,
    products: [
      { id: "p-ae-ps", name: "Protection Series", tiers: ["level", "graded", "modified"], issueAgeMin: 45, issueAgeMax: 89, faceMinCents: 200_000, faceMaxCents: 5_000_000, firstYearCommissionPct: 100, paymentMethods: ["ach", "debit_card", "direct_bill"], per1000Min: 1.9, per1000Max: 13.5 },
    ],
  },
  {
    id: "car-americo", name: "Americo", portalOrigin: "https://agent.example-americo.test",
    policyNumberPattern: "^\\d{10}$", policyNumberExample: "4400918273", billingDescriptor: "AMERICO LIFE INS",
    appointment: "pending", portalUsername: "rmason01", portalVerifiedDaysAgo: 12, ownFieldSet: true, fieldMap: "draft", platform: false,
    products: [
      { id: "p-am-ep", name: "Eagle Premier", tiers: ["level", "graded"], issueAgeMin: 40, issueAgeMax: 85, faceMinCents: 500_000, faceMaxCents: 4_000_000, firstYearCommissionPct: 115, paymentMethods: ["ach", "direct_express", "credit_card"], per1000Min: 2.4, per1000Max: 14.2 },
    ],
  },
  {
    id: "car-foresters", name: "Foresters", portalOrigin: "https://agent.example-foresters.test",
    policyNumberPattern: "^FR-\\d{7}$", policyNumberExample: "FR-2291834", billingDescriptor: "FORESTERS FINANCIAL",
    appointment: "appointed", portalUsername: "ray.m", portalVerifiedDaysAgo: 60, ownFieldSet: false, fieldMap: "none", platform: true,
    products: [
      { id: "p-fo-pr", name: "PlanRight", tiers: ["level", "graded", "modified"], issueAgeMin: 50, issueAgeMax: 85, faceMinCents: 250_000, faceMaxCents: 3_500_000, firstYearCommissionPct: 95, paymentMethods: ["ach", "direct_express", "debit_card", "credit_card"], per1000Min: 2.2, per1000Max: 14.5 },
    ],
  },
  {
    id: "car-corebridge", name: "Corebridge Financial", portalOrigin: "https://portal.example-corebridge.test",
    policyNumberPattern: "^CB\\d{9}$", policyNumberExample: "CB004418822", billingDescriptor: "COREBRIDGE FINANCIAL",
    appointment: "not_appointed", portalUsername: null, portalVerifiedDaysAgo: null, ownFieldSet: false, fieldMap: "none", platform: true,
    products: [
      { id: "p-cb-gi", name: "Guaranteed Issue Whole Life", tiers: ["gi"], issueAgeMin: 50, issueAgeMax: 80, faceMinCents: 500_000, faceMaxCents: 2_500_000, firstYearCommissionPct: 80, paymentMethods: ["ach", "debit_card", "credit_card", "direct_bill"], per1000Min: 4.8, per1000Max: 15 },
    ],
  },
];

// ── underwriting templates (LA-3.1) ──────────────────────────────────────────

export type UnderwritingTemplate = {
  id: string;
  name: string;
  productLabel: string;
  /** null = the general intake every carrier can use. */
  carrierName: string | null;
  version: number;
  status: "published" | "draft";
  usedBy: number;
  /** Seeded by Insurvas: its five persistency questions cannot be deleted. */
  seeded: boolean;
  questions: InterviewQuestion[];
};

const GENERAL_QUESTIONS: InterviewQuestion[] = FIXTURE_CASE.interviews.primary?.questions ?? [];
const PERSISTENCY = GENERAL_QUESTIONS.filter((q) => q.persistency);

export const UNDERWRITING_TEMPLATES: UnderwritingTemplate[] = [
  { id: "ut-general", name: "Final Expense — general intake", productLabel: "Final Expense", carrierName: null, version: 3, status: "published", usedBy: 42, seeded: true, questions: GENERAL_QUESTIONS },
  {
    id: "ut-mutual", name: "Living Promise health questions", productLabel: "Living Promise", carrierName: "Mutual of Omaha", version: 2, status: "published", usedBy: 17, seeded: true,
    questions: [
      ...PERSISTENCY,
      { key: "mo_nursing_home", section: "Health", label: "Are you in a nursing home, or confined to a bed or wheelchair?", type: "boolean", required: true, knockout: { when: true, note: "Mutual of Omaha declines Living Promise for this." } },
      { key: "mo_hiv", section: "Health", label: "Have you been diagnosed with HIV or AIDS?", type: "boolean", required: true, knockout: { when: true, note: "Only the guaranteed product is available." } },
      { key: "mo_copd", section: "Health", label: "In the last 2 years, have you been treated for COPD or emphysema?", type: "boolean", required: true },
      { key: "mo_copd_oxygen", section: "Health", label: "Do you use oxygen for it?", type: "boolean", showWhen: { key: "mo_copd", equals: true }, help: "A yes moves the client to the graded tier." },
      { key: "medications", section: "Medications", label: "Medications", type: "medication_list" },
    ],
  },
  {
    id: "ut-aetna", name: "Protection Series screen", productLabel: "Protection Series", carrierName: "Aetna", version: 1, status: "draft", usedBy: 0, seeded: false,
    questions: [
      ...PERSISTENCY,
      { key: "ae_heart", section: "Health", label: "In the last 2 years, have you had a heart attack, stroke or heart surgery?", type: "boolean", required: true },
      { key: "ae_heart_when", section: "Health", label: "How long ago?", type: "single_select", options: ["Under 12 months", "12 to 24 months"], showWhen: { key: "ae_heart", equals: true } },
      { key: "medications", section: "Medications", label: "Medications", type: "medication_list" },
    ],
  },
];

// ── quotation templates (LA-3.4) ─────────────────────────────────────────────

export type QuoteFieldInput = "text" | "number" | "select" | "boolean" | "date" | "money" | "state";
export type QuoteField = { key: string; label: string; input: QuoteFieldInput; required: boolean; help: string };
export type QuotationTemplate = {
  id: string;
  /** null = the generic Final Expense template, which always exists. */
  carrierName: string | null;
  productLabel: string;
  ageBasis: "nearest" | "last";
  version: number;
  status: "published" | "draft";
  fields: QuoteField[];
};

const BASE_QUOTE_FIELDS: QuoteField[] = [
  { key: "state", label: "State", input: "state", required: true, help: "" },
  { key: "dob", label: "Date of birth", input: "date", required: true, help: "" },
  { key: "gender", label: "Gender", input: "select", required: true, help: "" },
  { key: "tobacco", label: "Tobacco in the last 12 months", input: "boolean", required: true, help: "" },
  { key: "height_in", label: "Height (inches)", input: "number", required: true, help: "" },
  { key: "weight_lb", label: "Weight (lb)", input: "number", required: true, help: "" },
  { key: "face_amount", label: "Face amount", input: "money", required: false, help: "Leave blank to quote from the monthly budget." },
  { key: "monthly_budget", label: "Monthly budget", input: "money", required: false, help: "" },
];

const withHelp = (key: string, help: string) => BASE_QUOTE_FIELDS.map((f) => (f.key === key ? { ...f, help } : f));

export const QUOTATION_TEMPLATES: QuotationTemplate[] = [
  { id: "qt-generic", carrierName: null, productLabel: "Final Expense", ageBasis: "nearest", version: 4, status: "published", fields: BASE_QUOTE_FIELDS },
  { id: "qt-mutual", carrierName: "Mutual of Omaha", productLabel: "Living Promise", ageBasis: "last", version: 2, status: "published", fields: withHelp("tobacco", "This carrier counts cigars as tobacco.") },
  { id: "qt-americo", carrierName: "Americo", productLabel: "Eagle Premier", ageBasis: "nearest", version: 3, status: "published", fields: withHelp("tobacco", "Nicotine patches and gum count as tobacco here.") },
  { id: "qt-aetna", carrierName: "Aetna", productLabel: "Protection Series", ageBasis: "nearest", version: 1, status: "draft", fields: [...BASE_QUOTE_FIELDS, { key: "tier_preference", label: "Tier to quote", input: "select", required: false, help: "Aetna quotes Level first unless you choose." }] },
];

// ── application field sets (LA-3.7) ──────────────────────────────────────────

export type FieldSetEntry = { key: string; required: boolean; sort: number; help: string };
export type FieldSet = {
  id: string;
  /** null = the platform Final Expense set. */
  carrierName: string | null;
  productLabel: string;
  platform: boolean;
  /** null = no own set: the carrier uses the platform set. */
  entries: FieldSetEntry[] | null;
};

const ALL_CANONICAL_KEYS = CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
const PLATFORM_REQUIRED = new Set(["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in", "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip", "cov.face_amount", "cov.product_tier", "cov.monthly_premium"]);

function entries(extraRequired: string[] = [], help: Record<string, string> = {}): FieldSetEntry[] {
  const required = new Set([...PLATFORM_REQUIRED, ...extraRequired]);
  return ALL_CANONICAL_KEYS.map((key, i) => ({ key, required: required.has(key), sort: (i + 1) * 10, help: help[key] ?? "" }));
}

export const FIELD_SETS: FieldSet[] = [
  { id: "fs-platform", carrierName: null, productLabel: "Final Expense", platform: true, entries: entries() },
  ...SALES_CARRIERS.flatMap((c) =>
    c.products.map((p): FieldSet => ({
      id: `fs-${p.id}`,
      carrierName: c.name,
      productLabel: p.name,
      platform: false,
      entries: c.ownFieldSet
        ? c.id === "car-mutual"
          ? entries(["insured.birth_state", "insured.middle_initial"], { "insured.birth_state": "Mutual of Omaha asks for the state, or \"Other country\"." })
          : entries(["addr.years_at"], { "addr.years_at": "Under 2 years also needs the previous address." })
        : null,
    })),
  ),
];

// ── carrier field maps (LA-3.13) ─────────────────────────────────────────────

export type FieldMapKind = "text" | "select" | "radio" | "checkbox" | "date_parts";
export type FieldMapTransform = "none" | "digits_only" | "mmddyyyy" | "state_code" | "yes_no_yn" | "uppercase";
export type FieldMapEntry = { key: string; selector: string; kind: FieldMapKind; transform: FieldMapTransform; verified: boolean };
export type FieldMap = {
  id: string;
  carrierName: string;
  productLabel: string;
  origin: string;
  status: Exclude<FieldMapStatus, "none">;
  version: number;
  updatedDaysAgo: number;
  /** Why the map needs review, in the reader's words. */
  reviewReason: string | null;
  entries: FieldMapEntry[];
};

type RawEntry = [key: string, selector: string, kind: FieldMapKind, transform: FieldMapTransform];
const RAW_ENTRIES: RawEntry[] = [
  ["insured.first_name", "#applicant_first_name", "text", "none"],
  ["insured.last_name", "#applicant_last_name", "text", "none"],
  ["insured.dob", "#applicant_dob", "text", "mmddyyyy"],
  ["insured.gender", "input[name='sex']", "radio", "none"],
  ["insured.ssn", "#applicant_ssn", "text", "digits_only"],
  ["insured.birth_state", "#birth_state", "select", "state_code"],
  ["insured.tobacco", "input[name='tobacco_use']", "radio", "yes_no_yn"],
  ["contact.phone", "#primary_phone", "text", "digits_only"],
  ["addr.line1", "#street_address", "text", "none"],
  ["addr.state", "#address_state", "select", "state_code"],
  ["addr.zip", "#zip_code", "text", "digits_only"],
  ["pay.routing_number", "#eft_routing", "text", "digits_only"],
  ["pay.account_number", "#eft_account", "text", "digits_only"],
  ["pay.card_number", "#card_number", "text", "digits_only"],
  ["pay.draft_day", "#draft_day", "select", "none"],
];

function mapEntries(unverified: string[]): FieldMapEntry[] {
  return RAW_ENTRIES.map(([key, selector, kind, transform]) => ({ key, selector, kind, transform, verified: !unverified.includes(key) }));
}

export const FIELD_MAPS: FieldMap[] = [
  { id: "fm-mutual", carrierName: "Mutual of Omaha", productLabel: "Living Promise", origin: "https://producer.example-mutual.test", status: "published", version: 5, updatedDaysAgo: 21, reviewReason: null, entries: mapEntries([]) },
  { id: "fm-americo", carrierName: "Americo", productLabel: "Eagle Premier", origin: "https://agent.example-americo.test", status: "draft", version: 1, updatedDaysAgo: 2, reviewReason: null, entries: mapEntries(["pay.routing_number", "pay.card_number", "addr.zip"]) },
  { id: "fm-aetna", carrierName: "Aetna", productLabel: "Protection Series", origin: "https://agents.example-aetna.test", status: "needs_review", version: 3, updatedDaysAgo: 3, reviewReason: "Four fields were not found on Aetna's page on the last fill.", entries: mapEntries(["insured.ssn", "pay.account_number", "insured.birth_state", "pay.draft_day"]) },
];

// ── disclosures (LA-3.10) ────────────────────────────────────────────────────

export type RuleOperator = "eq" | "neq" | "in";
export type RuleClause = { field: string; op: RuleOperator; value: string };
/** Every clause in a rule must hold (AND). Two rules are OR. */
export type DisclosureRule = { clauses: RuleClause[] };
export type DisclosureRow = {
  id: string;
  code: string;
  title: string;
  body: string;
  /** Empty = all states. */
  states: string[];
  /** Empty = all carriers. */
  carriers: string[];
  version: number;
  status: "published" | "draft" | "retired";
  platform: boolean;
  rules: DisclosureRule[];
  attachmentName: string | null;
};

export const DISCLOSURES: DisclosureRow[] = [
  {
    id: "dc-replacement", code: "REPLACEMENT_NOTICE", title: "Notice regarding replacement",
    body: FIXTURE_ATTEMPT.disclosures[0]?.body ?? "", states: [], carriers: [], version: 2, status: "published", platform: true,
    rules: [{ clauses: [{ field: "health.existing_coverage", op: "eq", value: "yes" }] }], attachmentName: "replacement-notice-v2.pdf",
  },
  {
    id: "dc-1035", code: "1035_EXCHANGE", title: "1035 exchange disclosure",
    body: "You are using the value of an existing policy to pay for this one. Your old policy ends when the exchange completes, and any surrender charges on it still apply.",
    states: [], carriers: [], version: 1, status: "published", platform: true,
    rules: [{ clauses: [{ field: "health.existing_coverage", op: "eq", value: "yes" }, { field: "owner.same_as_insured", op: "eq", value: "yes" }] }], attachmentName: null,
  },
  {
    id: "dc-graded", code: "GRADED_BENEFIT", title: "Graded benefit explained",
    body: "For the first two years this policy pays back what you have paid in, plus interest, instead of the full amount — unless the death is an accident.",
    states: [], carriers: [], version: 3, status: "published", platform: false,
    rules: [{ clauses: [{ field: "cov.product_tier", op: "in", value: "graded, modified" }] }], attachmentName: null,
  },
  {
    id: "dc-tx-suitability", code: "TX_SUITABILITY", title: "Texas suitability statement",
    body: "Before you buy, we reviewed your needs, your income and the coverage you already have. Tell me now if anything we discussed has changed.",
    states: ["TX"], carriers: ["Mutual of Omaha", "Americo"], version: 1, status: "draft", platform: false,
    rules: [{ clauses: [{ field: "addr.state", op: "eq", value: "TX" }] }], attachmentName: null,
  },
];

// ── quote & QA rules ─────────────────────────────────────────────────────────

export type SalesPreferences = {
  per1000Min: string;
  per1000Max: string;
  missingAppointment: "warn" | "block";
  draftDayBuffer: 2 | 3 | 4;
  requirementAgeingDays: string;
  welcomePack: "automatic" | "review";
};

export const SALES_PREFERENCES: SalesPreferences = {
  per1000Min: "0.50",
  per1000Max: "15.00",
  missingAppointment: "warn",
  draftDayBuffer: 3,
  requirementAgeingDays: "5",
  welcomePack: "automatic",
};

// ── welcome pack (LA-3.20) ───────────────────────────────────────────────────

export const WELCOME_PACK_AGENT = { name: "Ray Mason", phone: "(817) 555-0199", email: "ray.mason@example.test" };

export const WELCOME_PACK_TEMPLATE = {
  subject: "Your {carrier_name} application — what happens next",
  body: [
    "Hi {client_first_name},",
    "Your application with {carrier_name} is in. Here is everything in one place.",
    "What will appear on your statement: {statement_descriptor}",
    "Your coverage: {coverage}",
    "Your payment: {monthly_amount} on the {draft_day} of each month.",
    "Your beneficiaries: {beneficiaries}",
    "If anything here is wrong, call me first — not your bank. {agent_phone}",
  ].join("\n\n"),
};

// ── pipeline sync (LA-3.23, STATUS-MODEL §6) ─────────────────────────────────

export const PIPELINE_SYNC_KEYS = [
  { key: "quoted", label: "Quoted", when: "Has a saved quote", defaultStage: "Quoted" },
  { key: "application_started", label: "Application started", when: "Is ready to submit", defaultStage: "Application started" },
  { key: "submitted", label: "Submitted", when: "Is submitted to the carrier", defaultStage: "Submitted" },
  { key: "pending_requirements", label: "Pending requirements", when: "Is waiting on the carrier, or a counteroffer", defaultStage: "Pending requirements" },
  { key: "issued", label: "Issued", when: "Is issued", defaultStage: "Issued" },
  { key: "requoting", label: "Requoting", when: "Was declined and a new attempt is open", defaultStage: "Quoted" },
  { key: "lost", label: "Lost", when: "Is lost, or withdrawn with nothing else open", defaultStage: "Lost" },
] as const;
export type PipelineSyncKey = (typeof PIPELINE_SYNC_KEYS)[number]["key"];

export const SAMPLE_PIPELINES = [
  { id: "pl-outbound", name: "Outbound" },
  { id: "pl-inbound", name: "Inbound" },
];
export const SAMPLE_STAGES = ["New", "Contacted", "Quoted", "Application started", "Submitted", "Pending requirements", "Issued", "Lost"];

// ── browser extension (LA-3.12) ──────────────────────────────────────────────

export const GRANT_MINUTES = 60;

export type ExtensionGrant = {
  id: string;
  clientName: string;
  reference: string | null;
  carrierName: string;
  origin: string;
  openedAt: string;
  /** Minutes since it opened, so "expires in" does not depend on the render clock. */
  openedMinutesAgo: number;
  fieldsRead: number;
  status: "active" | "expired" | "revoked";
};

export const EXTENSION_STATE = { detected: false, version: null as string | null, latestVersion: "1.4.2" };

export const EXTENSION_GRANTS: ExtensionGrant[] = [
  { id: "g1", clientName: "Rita M Alvarez", reference: null, carrierName: "Mutual of Omaha", origin: "https://producer.example-mutual.test", openedAt: minutesAgo(18), openedMinutesAgo: 18, fieldsRead: 14, status: "active" },
  { id: "g2", clientName: "Walter Kim", reference: "AE-5507741", carrierName: "Aetna", origin: "https://agents.example-aetna.test", openedAt: minutesAgo(41), openedMinutesAgo: 41, fieldsRead: 9, status: "active" },
  { id: "g3", clientName: "Dolores Ruiz", reference: null, carrierName: "Americo", origin: "https://agent.example-americo.test", openedAt: minutesAgo(190), openedMinutesAgo: 190, fieldsRead: 16, status: "expired" },
  { id: "g4", clientName: "Evelyn Carter", reference: "AE-5508123", carrierName: "Aetna", origin: "https://agents.example-aetna.test", openedAt: minutesAgo(1_420), openedMinutesAgo: 1_420, fieldsRead: 4, status: "revoked" },
];
