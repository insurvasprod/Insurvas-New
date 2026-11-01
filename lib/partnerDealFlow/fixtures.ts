/**
 * Sample days for `/design/deal-flow` (development only).
 *
 * The development database holds one lead, so without this the page could only ever be seen with
 * one row in one stage — and "verified" would mean "the happy path, once". Here the day can be
 * busy, quiet, empty or unreadable, for either role, and each of those is a different page.
 *
 * Plain module: no server imports, so the preview page and the tests can both read it.
 */
import { dealFlowFigures } from "./figures.ts";
import type { DealFlowStageType, PartnerDealFlowPayload, PartnerDealFlowRow } from "./types.ts";

export const SAMPLE_DEAL_FLOW_STATES = ["busy", "quiet", "empty", "error"] as const;
export type SampleDealFlowState = (typeof SAMPLE_DEAL_FLOW_STATES)[number];
export const SAMPLE_DEAL_FLOW_ROLES = ["partner_admin", "partner_user"] as const;
export type SampleDealFlowRole = (typeof SAMPLE_DEAL_FLOW_ROLES)[number];

/** A Monday, so the stepper's label reads like a working day. */
export const SAMPLE_DAY = "2026-11-02";

const ME = { id: "u-me", name: "Rion Test" };
const TEAM = [ME, { id: "u-dana", name: "Dana Whitfield" }, { id: "u-sam", name: "Sam Okafor" }];

type Spec = {
  customer: string;
  product: string;
  stage: DealFlowStageType;
  stageName: string;
  carrier?: string;
  plan?: string;
  monthly?: number;
  face?: number;
  draft?: string;
  outcome?: string;
  by?: { id: string; name: string };
  /** Days before the day on screen that the lead was submitted. */
  age?: number;
  hour?: number;
};

const BUSY: Spec[] = [
  { customer: "Marcus Bell", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Mutual of Omaha", plan: "Whole life", monthly: 8_450, face: 1_500_000, draft: "2026-11-15", outcome: "Application submitted", hour: 16 },
  { customer: "Yvonne Clarke", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Aetna", plan: "Whole life", monthly: 6_200, face: 1_000_000, draft: "2026-11-20", outcome: "Application submitted", by: TEAM[1], age: 1, hour: 15 },
  { customer: "Desmond Park", product: "medicare", stage: "won", stageName: "Submitted", carrier: "Humana", plan: "Advantage", outcome: "Application submitted", by: TEAM[2], age: 2, hour: 14 },
  { customer: "Nia Robertson", product: "final_expense", stage: "open", stageName: "Underwriting", carrier: "Mutual of Omaha", plan: "Whole life", monthly: 11_900, face: 2_000_000, age: 5, hour: 13 },
  { customer: "Harold Finch", product: "medicare", stage: "open", stageName: "Quoted", by: TEAM[1], age: 3, hour: 12 },
  { customer: "Priya Raman", product: "final_expense", stage: "open", stageName: "Contacted", by: TEAM[2], age: 1, hour: 11 },
  { customer: "Eli Vasquez", product: "medicare", stage: "lost", stageName: "Closed lost", outcome: "Not interested", age: 1, hour: 10 },
  { customer: "Brenda Okonkwo", product: "final_expense", stage: "lost", stageName: "Closed lost", outcome: "Not interested", by: TEAM[1], hour: 9 },
  { customer: "Terrence Wu", product: "final_expense", stage: "lost", stageName: "Closed lost", outcome: "Unable to reach", by: TEAM[2], age: 4, hour: 9 },
];

const QUIET: Spec[] = [
  { customer: "Marcus Bell", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Aetna", plan: "Whole life", monthly: 7_100, face: 1_200_000, draft: "2026-11-18", outcome: "Application submitted", hour: 14 },
  { customer: "Harold Finch", product: "medicare", stage: "open", stageName: "Quoted", age: 2, hour: 11 },
];

function shift(day: string, back: number) {
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() - back);
  return moved.toISOString().slice(0, 10);
}

function rowsFrom(specs: readonly Spec[], day: string, role: SampleDealFlowRole): PartnerDealFlowRow[] {
  const all = specs.map((spec): PartnerDealFlowRow => ({
    leadId: `lead-${spec.customer.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    day,
    customer: spec.customer,
    productLine: spec.product,
    stageName: spec.stageName,
    stageType: spec.stage,
    carrier: spec.carrier ?? null,
    productType: spec.plan ?? null,
    monthlyPremiumCents: spec.monthly ?? null,
    faceAmountCents: spec.face ?? null,
    draftDate: spec.draft ?? null,
    outcome: spec.outcome ?? null,
    submittedBy: spec.by ?? ME,
    submittedDay: shift(day, spec.age ?? 0),
    updatedAt: `${day}T${String(spec.hour ?? 12).padStart(2, "0")}:40:00.000Z`,
  }));
  // A partner user sees only their own submissions — the same narrowing `effectiveCloser` applies,
  // so the two roles can be compared side by side on the preview.
  return role === "partner_user" ? all.filter((row) => row.submittedBy.id === ME.id) : all;
}

export function sampleDealFlow(options: { state?: SampleDealFlowState; role?: SampleDealFlowRole; day?: string } = {}): PartnerDealFlowPayload {
  const { state = "busy", role = "partner_admin", day = SAMPLE_DAY } = options;
  const rows = state === "empty" || state === "error" ? [] : rowsFrom(state === "quiet" ? QUIET : BUSY, day, role);
  return {
    from: day,
    to: day,
    today: SAMPLE_DAY,
    rows,
    figures: dealFlowFigures(rows.map((row) => ({
      stageType: row.stageType,
      monthlyPremiumCents: row.monthlyPremiumCents,
      submittedDay: row.submittedDay,
      outcome: row.outcome,
    })), day),
    stageCounts: {
      open: rows.filter((row) => row.stageType === "open").length,
      won: rows.filter((row) => row.stageType === "won").length,
      lost: rows.filter((row) => row.stageType === "lost").length,
    },
    facets: {
      products: [...new Set(rows.map((row) => row.productLine))].sort(),
      submitters: role === "partner_user" ? [ME] : TEAM,
    },
    capped: false,
    generatedAt: `${day}T17:00:00.000Z`,
  };
}
