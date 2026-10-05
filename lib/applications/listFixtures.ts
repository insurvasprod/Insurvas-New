/**
 * DESIGN FIXTURES — LA-3 Design phase only.
 *
 * Extra sample rows for the LA-3 list and report pages (/app/applications, /app/quoting,
 * /app/pending, /app/sales-performance, /admin/field-maps), in the shapes those pages render. Every
 * page that imports this file shows the "Sample data" notice. The Build phase replaces each import
 * with a fetch; nothing here is ever written anywhere, and no server route may import it. Names,
 * numbers, selectors and URLs are invented.
 *
 * The report figures are internally consistent on purpose: every numerator is at most its
 * denominator, each carrier's funnel only narrows, the per-carrier rows sum to the totals, and the
 * decline cross-tab's column sums are the carriers' decline counts.
 */

import { divRoundHalfUp } from "@/lib/quotes/math";
import type { ApplicationStatus, InsuredRole, OutcomeReasonCode, RequirementKind } from "./constants";
import { FIXTURE_APPLICATIONS, FIXTURE_CASE_ID, FIXTURE_COUNTEROFFER, FIXTURE_PENDING } from "./fixtures";
import type { ApplicationListRow, PendingRow, QuoteView } from "./types";

const now = new Date();
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => hoursAgo(n * 24);
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);
const hoursAhead = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();

// ── Quotes across cases (/app/quoting) ───────────────────────────────────────

/** A saved quote with the case it belongs to. Local to the list; `QuoteView` has no case fields. */
export type QuoteListRow = QuoteView & { caseId: string; clientName: string; insuredRole: InsuredRole; state: string | null };

const APPOINTED = { ok: true, reason: null } as const;

const quote = (r: Partial<QuoteListRow> & Pick<QuoteListRow, "id" | "caseId" | "clientName" | "carrierName" | "productLabel" | "tier" | "faceAmountCents" | "monthlyPremiumCents" | "status" | "createdAt">): QuoteListRow => ({
  carrierId: `car-${r.carrierName.toLowerCase().split(" ")[0]}`, insuredRole: "primary", state: "TX", riders: [], ageUsed: null,
  appointed: APPOINTED, acceptsPaymentMethod: true, warnings: [], payout: null, ...r,
});

export const FIXTURE_QUOTE_LIST: QuoteListRow[] = [
  // Rita Alvarez (the sample case): the three quotes from this attempt, and the Foresters one from attempt 1.
  quote({ id: "q1", caseId: FIXTURE_CASE_ID, clientName: "Rita M Alvarez", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 6_840, ageUsed: 72, status: "selected", createdAt: daysAgo(2) }),
  quote({ id: "q2", caseId: FIXTURE_CASE_ID, clientName: "Rita M Alvarez", carrierName: "Aetna", productLabel: "Protection Series", tier: "graded", faceAmountCents: 1_000_000, monthlyPremiumCents: 5_910, ageUsed: 72, status: "discarded", createdAt: daysAgo(2) }),
  quote({ id: "q3", caseId: FIXTURE_CASE_ID, clientName: "Rita M Alvarez", carrierName: "Americo", productLabel: "Eagle Premier", tier: "level", faceAmountCents: 1_200_000, monthlyPremiumCents: 7_920, ageUsed: 72, status: "discarded", appointed: { ok: false, reason: "No active Americo appointment in TX." }, createdAt: daysAgo(2) }),
  quote({ id: "q0", caseId: FIXTURE_CASE_ID, clientName: "Rita M Alvarez", carrierName: "Foresters", productLabel: "PlanRight", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 6_450, ageUsed: 72, status: "selected", createdAt: daysAgo(9) }),
  quote({ id: "q10", caseId: "case-1", clientName: "Dolores Ruiz", state: "AZ", carrierName: "Americo", productLabel: "Eagle Premier", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 7_100, ageUsed: 68, status: "selected", createdAt: daysAgo(1) }),
  quote({ id: "q11", caseId: "case-1", clientName: "Dolores Ruiz", state: "AZ", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 7_480, ageUsed: 68, status: "presented", createdAt: daysAgo(1) }),
  quote({ id: "q12", caseId: "case-2", clientName: "Harold Briggs", state: "OK", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 800_000, monthlyPremiumCents: 5_425, ageUsed: 70, status: "selected", createdAt: daysAgo(3) }),
  quote({ id: "q13", caseId: "case-3", clientName: "Evelyn Carter", carrierName: "Aetna", productLabel: "Protection Series", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 8_210, ageUsed: 66, status: "selected", createdAt: daysAgo(5) }),
  quote({ id: "q14", caseId: "case-3", clientName: "Evelyn Carter", carrierName: "Foresters", productLabel: "PlanRight", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 8_990, ageUsed: 66, status: "discarded", createdAt: daysAgo(5) }),
  quote({ id: "q15", caseId: "case-4", clientName: "Walter Kim", state: "NM", carrierName: "Aetna", productLabel: "Protection Series", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 7_420, ageUsed: 74, status: "selected", createdAt: daysAgo(6) }),
  quote({ id: "q16", caseId: "case-4", clientName: "Betty Kim", insuredRole: "spouse", state: "NM", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 6_020, ageUsed: 71, status: "selected", createdAt: daysAgo(6) }),
  quote({ id: "q17", caseId: "case-6", clientName: "Frank Delgado", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 700_000, monthlyPremiumCents: 4_870, ageUsed: 69, status: "selected", createdAt: daysAgo(12) }),
  quote({ id: "q18", caseId: "case-8", clientName: "Nancy Whitfield", state: "OK", carrierName: "Foresters", productLabel: "PlanRight", tier: "level", faceAmountCents: 1_000_000, monthlyPremiumCents: 6_300, ageUsed: 73, status: "selected", createdAt: daysAgo(15) }),
  // Quotes on leads that never became an application: the "she's calling back" case.
  quote({ id: "q19", caseId: "case-11", clientName: "Marjorie Lane", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "graded", faceAmountCents: 500_000, monthlyPremiumCents: 4_615, ageUsed: 77, status: "discarded", createdAt: daysAgo(21) }),
  quote({ id: "q20", caseId: "case-11", clientName: "Marjorie Lane", carrierName: "Americo", productLabel: "Eagle Premier", tier: "gi", faceAmountCents: 500_000, monthlyPremiumCents: 5_940, ageUsed: 77, status: "discarded", appointed: { ok: false, reason: "Americo appointment is pending in TX." }, createdAt: daysAgo(21) }),
  quote({ id: "q21", caseId: "case-12", clientName: "Leonard Price", state: "OK", carrierName: "Aetna", productLabel: "Protection Series", tier: "modified", faceAmountCents: 1_000_000, monthlyPremiumCents: 9_880, ageUsed: 79, status: "presented", createdAt: daysAgo(4) }),
  quote({ id: "q22", caseId: "case-13", clientName: "Irene Castillo", state: "AZ", carrierName: "Foresters", productLabel: "PlanRight", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 7_035, ageUsed: 64, status: "draft", appointed: { ok: false, reason: "No Foresters appointment in AZ." }, createdAt: hoursAgo(3) }),
  quote({ id: "q23", caseId: "case-14", clientName: "George Mendez", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 2_000_000, monthlyPremiumCents: 11_260, ageUsed: 67, status: "presented", createdAt: daysAgo(34) }),
  quote({ id: "q24", caseId: "case-14", clientName: "George Mendez", carrierName: "Aetna", productLabel: "Protection Series", tier: "level", faceAmountCents: 2_000_000, monthlyPremiumCents: 10_940, ageUsed: 67, status: "discarded", createdAt: daysAgo(34) }),
];

// ── Pending cases (/app/pending) ─────────────────────────────────────────────

/** More open requirements beside FIXTURE_PENDING, so the queue reads like a working book. */
export const FIXTURE_PENDING_MORE: PendingRow[] = [
  { id: "r6", applicationId: "app-5", caseId: "case-4", clientName: "Betty Kim", carrierName: "Mutual of Omaha", monthlyPremiumCents: 6_020, kind: "amendment", description: "Sign the amendment correcting her date of birth.", waitingOn: "client", status: "open", raisedAt: dateAgo(5), dueAt: null, lastChasedAt: daysAgo(0), chaseCount: 1, daysOpen: 5, daysSinceChase: 0, ageing: "amber" },
  { id: "r7", applicationId: "app-15", caseId: "case-15", clientName: "Loretta Banks", carrierName: "Aetna", monthlyPremiumCents: 7_760, kind: "paramed_exam", description: "Paramed exam — the vendor could not reach her to book.", waitingOn: "client", status: "open", raisedAt: dateAgo(10), dueAt: null, lastChasedAt: daysAgo(4), chaseCount: 2, daysOpen: 10, daysSinceChase: 4, ageing: "red" },
  { id: "r8", applicationId: "app-2", caseId: "case-2", clientName: "Harold Briggs", carrierName: "Mutual of Omaha", monthlyPremiumCents: 5_425, kind: "missing_info", description: "Carrier asks for the second beneficiary's relationship.", waitingOn: "carrier", status: "in_progress", raisedAt: dateAgo(3), dueAt: null, lastChasedAt: null, chaseCount: 0, daysOpen: 3, daysSinceChase: null, ageing: "ok" },
  { id: "r9", applicationId: "app-19", caseId: "case-19", clientName: "Arthur Nolan", carrierName: "Foresters", monthlyPremiumCents: 4_990, kind: "phone_interview", description: "Phone health interview — booked for Thursday.", waitingOn: "carrier", status: "in_progress", raisedAt: dateAgo(4), dueAt: null, lastChasedAt: daysAgo(1), chaseCount: 1, daysOpen: 4, daysSinceChase: 1, ageing: "ok" },
];

export const FIXTURE_PENDING_ALL: PendingRow[] = [...FIXTURE_PENDING, ...FIXTURE_PENDING_MORE];

/** One counteroffer row as the Pending list shows it. Same shape as FIXTURE_COUNTEROFFER. */
export type CounterofferRow = typeof FIXTURE_COUNTEROFFER;

export const FIXTURE_COUNTEROFFERS: CounterofferRow[] = [
  FIXTURE_COUNTEROFFER,
  { id: "co-2", clientName: "Irma Solis", caseId: "case-17", carrierName: "Mutual of Omaha", receivedAt: daysAgo(4), applied: { tier: "level", healthClass: null, faceCents: 1_000_000, monthlyCents: 6_110 }, offered: { tier: "graded", healthClass: null, faceCents: 1_000_000, monthlyCents: 7_390 }, reason: "Build chart — weight over the level limit.", expiresAt: hoursAhead(50), status: "pending_client" },
  { id: "co-3", clientName: "Samuel Ortega", caseId: "case-18", carrierName: "Foresters", receivedAt: daysAgo(6), applied: { tier: "level", healthClass: null, faceCents: 1_200_000, monthlyCents: 7_020 }, offered: { tier: "modified", healthClass: null, faceCents: 800_000, monthlyCents: 7_020 }, reason: "Medication disclosed (insulin), lower face offered.", expiresAt: hoursAhead(18), status: "pending_client" },
];

/** A submitted application still missing its carrier reference or its policy number. */
export type AwaitingNumberRow = ApplicationListRow & { submittedAt: string; missing: "reference" | "policy_number" };

const SUBMITTED_STATUSES: readonly ApplicationStatus[] = ["submitted", "pending_carrier", "counteroffer_pending"];

/** The orphan rule, as `missingNumber` in components/app/applications/applications-list.tsx applies it. */
function missingNumber(row: ApplicationListRow): AwaitingNumberRow["missing"] | null {
  if (SUBMITTED_STATUSES.includes(row.status) && !row.reference) return "reference";
  if (row.status === "closed" && row.outcome === "issued" && !row.policyNumber) return "policy_number";
  return null;
}

const listRow = (r: Partial<ApplicationListRow> & Pick<ApplicationListRow, "caseId" | "clientName" | "status">): ApplicationListRow => ({
  applicationId: `app-${r.caseId.split("-")[1]}`, leadId: `lead-${r.caseId.split("-")[1]}`, insuredRole: "primary", state: "TX", carrierName: "Mutual of Omaha", productLabel: "Living Promise",
  attemptNo: 1, outcome: null, monthlyPremiumCents: 6_840, qaVerdict: "pass", reference: null, policyNumber: null, updatedAt: daysAgo(1), ...r,
});

export const FIXTURE_AWAITING_NUMBER: AwaitingNumberRow[] = [
  // From FIXTURE_APPLICATIONS. The fixture carries no submit time, so its last update stands in.
  ...FIXTURE_APPLICATIONS.flatMap((row) => { const missing = missingNumber(row); return missing ? [{ ...row, submittedAt: row.updatedAt, missing }] : []; }),
  { ...listRow({ caseId: "case-15", clientName: "Loretta Banks", carrierName: "Aetna", productLabel: "Protection Series", status: "submitted", monthlyPremiumCents: 7_760, updatedAt: daysAgo(6) }), submittedAt: daysAgo(6), missing: "reference" },
  { ...listRow({ caseId: "case-16", clientName: "Curtis Hale", carrierName: "Foresters", productLabel: "PlanRight", status: "closed", outcome: "issued", monthlyPremiumCents: 4_990, reference: "FR-2293310", updatedAt: daysAgo(3) }), submittedAt: daysAgo(11), missing: "policy_number" },
];

// ── Sales performance (/app/sales-performance) ───────────────────────────────

export type ReportCarrier = { id: string; name: string };
export const REPORT_CARRIERS: ReportCarrier[] = [
  { id: "car-foresters", name: "Foresters" },
  { id: "car-mutual", name: "Mutual of Omaha" },
  { id: "car-aetna", name: "Aetna" },
  { id: "car-americo", name: "Americo" },
];

export const REPORT_PRODUCTS = ["Living Promise", "Protection Series", "Eagle Premier", "PlanRight"] as const;
export const REPORT_LEAD_SOURCES = ["Inbound transfers", "TX aged FE — Sept", "Web leads", "Referrals"] as const;
export const REPORT_PRODUCERS = ["Ray Mason", "Tina Brooks", "Luis Ferrer"] as const;

/**
 * One carrier's funnel over the period. Cases are counted once, against the carrier of the quote
 * that was chosen. `placedKnown` is how many issued policies have a first-draft result at all;
 * `placed` counts only those whose first draft cleared — never "issued" by another name.
 */
export type CarrierFunnel = { carrierId: string; quoted: number; applied: number; submitted: number; issued: number; placedKnown: number; placed: number };

export const FIXTURE_FUNNEL: CarrierFunnel[] = [
  { carrierId: "car-foresters", quoted: 71, applied: 44, submitted: 38, issued: 20, placedKnown: 14, placed: 11 },
  { carrierId: "car-mutual", quoted: 162, applied: 98, submitted: 84, issued: 62, placedKnown: 44, placed: 38 },
  { carrierId: "car-aetna", quoted: 108, applied: 66, submitted: 57, issued: 35, placedKnown: 22, placed: 18 },
  { carrierId: "car-americo", quoted: 71, applied: 43, submitted: 35, issued: 22, placedKnown: 16, placed: 14 },
];

/** Declined and postponed attempts by reason, per carrier. Column sums are each carrier's declines. */
export const FIXTURE_DECLINES: Record<string, Partial<Record<OutcomeReasonCode, number>>> = {
  "car-foresters": { medication: 9, recent_hospitalisation: 2, prior_decline: 1, incomplete_application: 1, replacement_not_disclosed: 1 },
  "car-mutual": { medication: 2, recent_hospitalisation: 1, height_weight: 6, banking_nsf: 2, incomplete_application: 1 },
  "car-aetna": { medication: 1, recent_hospitalisation: 5, height_weight: 1, incomplete_application: 2, replacement_not_disclosed: 1 },
  "car-americo": { height_weight: 1, prior_decline: 2, banking_nsf: 1, other: 1 },
};

/**
 * Counteroffers per carrier. `accepted + refused + pending = counteroffers`; the acceptance rate is
 * over decided offers only (accepted + refused). Accepted ones are inside the issued count.
 */
export type CarrierCounteroffers = { carrierId: string; counteroffers: number; accepted: number; refused: number; pending: number; topReason: OutcomeReasonCode };

export const FIXTURE_COUNTEROFFER_STATS: CarrierCounteroffers[] = [
  { carrierId: "car-foresters", counteroffers: 3, accepted: 2, refused: 1, pending: 0, topReason: "medication" },
  { carrierId: "car-mutual", counteroffers: 4, accepted: 3, refused: 1, pending: 0, topReason: "height_weight" },
  { carrierId: "car-aetna", counteroffers: 9, accepted: 5, refused: 2, pending: 2, topReason: "recent_hospitalisation" },
  { carrierId: "car-americo", counteroffers: 2, accepted: 1, refused: 1, pending: 0, topReason: "prior_decline" },
];

/** Medians per carrier, with how many cases each median is taken over. */
export type CarrierTiming = { carrierId: string; quoteToSubmitHours: number; quoteToSubmitN: number; submitToIssueDays: number; submitToIssueN: number };

export const FIXTURE_TIMING: CarrierTiming[] = [
  { carrierId: "car-foresters", quoteToSubmitHours: 1.6, quoteToSubmitN: 38, submitToIssueDays: 9, submitToIssueN: 20 },
  { carrierId: "car-mutual", quoteToSubmitHours: 0.9, quoteToSubmitN: 84, submitToIssueDays: 6, submitToIssueN: 62 },
  { carrierId: "car-aetna", quoteToSubmitHours: 2.4, quoteToSubmitN: 57, submitToIssueDays: 14, submitToIssueN: 35 },
  { carrierId: "car-americo", quoteToSubmitHours: 1.1, quoteToSubmitN: 35, submitToIssueDays: 4, submitToIssueN: 22 },
];
/** Across all carriers (a median of medians is not a median, so it is its own figure). */
export const FIXTURE_TIMING_ALL = { quoteToSubmitHours: 1.3, quoteToSubmitN: 214, submitToIssueDays: 8, submitToIssueN: 139 };

/** Median days a requirement of each kind sat open before it closed, per carrier: [median, n]. */
export const FIXTURE_REQUIREMENT_DAYS: Partial<Record<RequirementKind, Record<string, [number, number]>>> = {
  aps: { "car-foresters": [16, 6], "car-mutual": [12, 9], "car-aetna": [21, 11], "car-americo": [9, 2] },
  phone_interview: { "car-foresters": [4, 8], "car-mutual": [2, 14], "car-aetna": [5, 12], "car-americo": [3, 5] },
  voice_verification: { "car-foresters": [1, 3], "car-mutual": [1, 18], "car-aetna": [2, 9], "car-americo": [1, 11] },
  missing_info: { "car-foresters": [2, 5], "car-mutual": [1, 7], "car-aetna": [3, 6], "car-americo": [1, 3] },
  amendment: { "car-foresters": [6, 2], "car-mutual": [4, 5], "car-aetna": [5, 4], "car-americo": [3, 1] },
  paramed_exam: { "car-mutual": [11, 3], "car-aetna": [13, 6] },
};

/** Premium totals per carrier (monthly, in cents) and the contract level used to estimate commission. */
export type CarrierPremium = { carrierId: string; submittedMonthlyCents: number; issuedMonthlyCents: number; contractRateBp: number };

export const FIXTURE_PREMIUM: CarrierPremium[] = [
  { carrierId: "car-foresters", submittedMonthlyCents: 231_800, issuedMonthlyCents: 118_400, contractRateBp: 11_000 },
  { carrierId: "car-mutual", submittedMonthlyCents: 552_300, issuedMonthlyCents: 401_900, contractRateBp: 10_500 },
  { carrierId: "car-aetna", submittedMonthlyCents: 402_400, issuedMonthlyCents: 239_750, contractRateBp: 10_000 },
  { carrierId: "car-americo", submittedMonthlyCents: 248_500, issuedMonthlyCents: 152_900, contractRateBp: 11_500 },
];

/** Estimated first-year commission on issued premium: annualised × contract level, half-up. */
export const estimatedFycCents = (row: CarrierPremium) => divRoundHalfUp(row.issuedMonthlyCents * 12 * row.contractRateBp, 10_000);

// ── Field maps (/admin/field-maps) ───────────────────────────────────────────

export const FIELD_MAP_STATUSES = ["draft", "in_review", "published", "needs_review", "retired"] as const;
export type FieldMapStatus = (typeof FIELD_MAP_STATUSES)[number];

export type FieldMapInputKind = "text" | "date" | "select" | "radio" | "masked" | "checkbox";

export type FieldMapEntry = {
  id: string;
  /** The carrier page the field is on (`carrier_field_map_step.page_key`). */
  pageKey: string;
  fieldKey: string;
  selector: string;
  selectorFallback: string | null;
  inputKind: FieldMapInputKind;
  transform: string | null;
  /** Share of fills that found the field, 0–1; null until the map has been used. */
  confidence: number | null;
  verified: boolean;
};

export type FieldMapMiss = { id: string; fieldKey: string; url: string; at: string };

export type FieldMapRow = {
  id: string;
  carrierName: string;
  productLabel: string;
  version: number;
  status: FieldMapStatus;
  origin: string;
  entries: FieldMapEntry[];
  misses: FieldMapMiss[];
  updatedAt: string;
};

type EntrySeed = [fieldKey: string, pageKey: string, name: string, inputKind: FieldMapInputKind, transform: string | null];

const ENTRY_SEEDS: EntrySeed[] = [
  ["insured.first_name", "applicant", "firstName", "text", null],
  ["insured.middle_initial", "applicant", "middleInitial", "text", "First letter, upper case"],
  ["insured.last_name", "applicant", "lastName", "text", null],
  ["insured.dob", "applicant", "dateOfBirth", "date", "YYYY-MM-DD → MM/DD/YYYY"],
  ["insured.gender", "applicant", "gender", "radio", "female → F, male → M"],
  ["insured.ssn", "applicant", "ssn", "masked", "Digits only"],
  ["insured.birth_state", "applicant", "birthState", "select", "State code → name"],
  ["insured.height_in", "health", "heightInches", "text", "Inches → feet and inches"],
  ["insured.weight_lb", "health", "weight", "text", null],
  ["insured.tobacco", "health", "tobaccoUse", "radio", "yes → Y, no → N"],
  ["contact.phone", "applicant", "phone", "text", "(###) ###-####"],
  ["contact.email", "applicant", "email", "text", null],
  ["addr.line1", "applicant", "street", "text", null],
  ["addr.city", "applicant", "city", "text", null],
  ["addr.state", "applicant", "state", "select", null],
  ["addr.zip", "applicant", "zip", "text", "First five digits"],
  ["cov.face_amount", "coverage", "faceAmount", "select", "Cents → whole dollars"],
  ["pay.method", "payment", "paymentMethod", "radio", "ach → EFT"],
  ["pay.routing_number", "payment", "routingNumber", "masked", "Digits only"],
  ["pay.account_number", "payment", "accountNumber", "masked", "Digits only"],
  ["pay.card_number", "payment", "cardNumber", "masked", "Digits only"],
  ["pay.draft_day", "payment", "draftDay", "select", null],
];

function entries(mapId: string, style: (name: string, page: string) => string, opts: { unverified?: string[]; confidence?: (i: number) => number | null; fallback?: boolean } = {}): FieldMapEntry[] {
  return ENTRY_SEEDS.map(([fieldKey, pageKey, name, inputKind, transform], i) => ({
    id: `${mapId}-e${i + 1}`,
    pageKey,
    fieldKey,
    selector: style(name, pageKey),
    selectorFallback: opts.fallback ? `[aria-label="${name.replace(/([A-Z])/g, " $1").toLowerCase()}"]` : null,
    inputKind,
    transform,
    confidence: opts.confidence ? opts.confidence(i) : null,
    verified: !(opts.unverified ?? []).includes(fieldKey),
  }));
}

const mutual = (name: string, page: string) => `#${page}_${name}`;
const aetna = (name: string) => `input[name="applicant.${name}"]`;
const americo = (name: string, page: string) => `[data-field="${page}.${name}"]`;
const foresters = (name: string) => `#ctl00_Main_${name[0].toUpperCase()}${name.slice(1)}`;

export const FIXTURE_FIELD_MAPS: FieldMapRow[] = [
  {
    id: "fm-mutual-4", carrierName: "Mutual of Omaha", productLabel: "Living Promise", version: 4, status: "draft",
    origin: "https://producer.example-mutual.test/eapp",
    entries: entries("fm-mutual-4", mutual, { unverified: ["insured.ssn", "pay.account_number", "insured.middle_initial", "addr.zip"] }),
    misses: [], updatedAt: hoursAgo(5),
  },
  {
    id: "fm-americo-1", carrierName: "Americo", productLabel: "Eagle Premier", version: 1, status: "in_review",
    origin: "https://agents.example-americo.test/apply",
    entries: entries("fm-americo-1", americo, { unverified: ["pay.draft_day"] }),
    misses: [], updatedAt: daysAgo(1),
  },
  {
    id: "fm-aetna-2", carrierName: "Aetna", productLabel: "Protection Series", version: 2, status: "needs_review",
    origin: "https://portal.example-aetna.test/fe/application",
    entries: entries("fm-aetna-2", aetna, { confidence: (i) => ([6, 7].includes(i) ? 0.41 : i === 18 ? 0.62 : 0.97), fallback: true }),
    misses: [
      { id: "mm-1", fieldKey: "insured.height_in", url: "https://portal.example-aetna.test/fe/application/health", at: daysAgo(2) },
      { id: "mm-2", fieldKey: "insured.weight_lb", url: "https://portal.example-aetna.test/fe/application/health", at: daysAgo(2) },
      { id: "mm-3", fieldKey: "pay.routing_number", url: "https://portal.example-aetna.test/fe/application/payment", at: daysAgo(4) },
    ],
    updatedAt: daysAgo(2),
  },
  {
    id: "fm-mutual-3", carrierName: "Mutual of Omaha", productLabel: "Living Promise", version: 3, status: "published",
    origin: "https://producer.example-mutual.test/eapp",
    entries: entries("fm-mutual-3", mutual, { confidence: (i) => (i === 16 ? 0.93 : 0.99) }),
    misses: [{ id: "mm-4", fieldKey: "cov.face_amount", url: "https://producer.example-mutual.test/eapp/coverage", at: daysAgo(19) }],
    updatedAt: daysAgo(40),
  },
  {
    id: "fm-foresters-2", carrierName: "Foresters", productLabel: "PlanRight", version: 2, status: "published",
    origin: "https://agent.example-foresters.test/newbusiness",
    entries: entries("fm-foresters-2", foresters, { confidence: () => 0.98, fallback: true }),
    misses: [], updatedAt: daysAgo(63),
  },
  {
    id: "fm-foresters-1", carrierName: "Foresters", productLabel: "PlanRight", version: 1, status: "retired",
    origin: "https://agent.example-foresters.test/newbusiness",
    entries: entries("fm-foresters-1", foresters, { confidence: () => 0.88 }),
    misses: [], updatedAt: daysAgo(63),
  },
];

export const FIELD_MAP_CARRIERS = ["Aetna", "Americo", "Foresters", "Mutual of Omaha"] as const;
