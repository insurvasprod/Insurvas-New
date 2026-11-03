/**
 * Sample days for `/design/deal-flow` (development only).
 *
 * The development database holds one lead, so without this the page could only ever be seen with
 * one row in one stage — and "verified" would mean "the happy path, once". Here the day can be
 * busy, quiet, empty or unreadable, for either role, and each of those is a different page.
 *
 * ## Why the sample organisation has two teams
 *
 * Since 2 Nov a `partner_admin` sees their own team on this page, not the whole organisation
 * (`lib/partnerAuth/team.ts`). On a flat list of submitters that rule is invisible: every row
 * passes, so a build that had lost the rule entirely would look exactly like a build that kept it.
 * So Sample Publishing Co. has two admins with their own reports and one member nobody has
 * assigned, and the day holds deals from all six — most of which the viewer must not see.
 *
 * The narrowing below calls `visibleSubmitters`, the same function the route calls. The preview
 * therefore shows what the page will show rather than an imitation of it, and if the rule changes
 * the preview changes with it.
 *
 * Plain module: no server imports, so the preview page and the tests can both read it.
 */
import { visibleSubmitters, type PartnerMember } from "../partnerAuth/team.ts";
import { dealFlowFigures } from "./figures.ts";
import type { DealFlowStageType, PartnerDealFlowPayload, PartnerDealFlowRow } from "./types.ts";

export const SAMPLE_DEAL_FLOW_STATES = ["busy", "quiet", "empty", "error"] as const;
export type SampleDealFlowState = (typeof SAMPLE_DEAL_FLOW_STATES)[number];
export const SAMPLE_DEAL_FLOW_ROLES = ["partner_admin", "partner_user"] as const;
export type SampleDealFlowRole = (typeof SAMPLE_DEAL_FLOW_ROLES)[number];

/** A Monday, so the stepper's label reads like a working day. */
export const SAMPLE_DAY = "2026-11-02";

const RION = { id: "u-rion", name: "Rion Test" };
const DANA = { id: "u-dana", name: "Dana Whitfield" };
const SAM = { id: "u-sam", name: "Sam Okafor" };
const NOOR = { id: "u-noor", name: "Noor Haddad" };
const THEO = { id: "u-theo", name: "Theo Lindqvist" };
const ORLA = { id: "u-orla", name: "Orla Byrne" };

const PEOPLE = [RION, DANA, SAM, NOOR, THEO, ORLA];
const nameOf = (id: string) => PEOPLE.find((person) => person.id === id)?.name ?? id;

/**
 * The membership rows, shaped as `partner_users` holds them. Two admins, who are peers and so
 * report to nobody; two reports for Rion, one for Noor; and Orla, whom nobody has assigned — on
 * this page her deals reach no admin at all, which is the decision (owner, 1 Nov) and is the case
 * most worth being able to look at.
 */
export const SAMPLE_PARTNER_MEMBERS: PartnerMember[] = [
  { user_id: RION.id, role: "partner_admin", partner_admin_user_id: null },
  { user_id: NOOR.id, role: "partner_admin", partner_admin_user_id: null },
  { user_id: DANA.id, role: "partner_user", partner_admin_user_id: RION.id },
  { user_id: SAM.id, role: "partner_user", partner_admin_user_id: RION.id },
  { user_id: THEO.id, role: "partner_user", partner_admin_user_id: NOOR.id },
  { user_id: ORLA.id, role: "partner_user", partner_admin_user_id: null },
];

/** Who you are on the preview: one of the two admins, or one of that admin's own people. */
const VIEWER: Record<SampleDealFlowRole, { id: string; name: string }> = {
  partner_admin: RION,
  partner_user: DANA,
};

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

// Twelve deals across all six people. Rion sees nine of them; Dana sees three.
const BUSY: Spec[] = [
  { customer: "Marcus Bell", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Mutual of Omaha", plan: "Whole life", monthly: 8_450, face: 1_500_000, draft: "2026-11-15", outcome: "Application submitted", hour: 16 },
  { customer: "Yvonne Clarke", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Aetna", plan: "Whole life", monthly: 6_200, face: 1_000_000, draft: "2026-11-20", outcome: "Application submitted", by: DANA, age: 1, hour: 15 },
  { customer: "Desmond Park", product: "medicare", stage: "won", stageName: "Submitted", carrier: "Humana", plan: "Advantage", outcome: "Application submitted", by: SAM, age: 2, hour: 14 },
  { customer: "Nia Robertson", product: "final_expense", stage: "open", stageName: "Underwriting", carrier: "Mutual of Omaha", plan: "Whole life", monthly: 11_900, face: 2_000_000, age: 5, hour: 13 },
  { customer: "Harold Finch", product: "medicare", stage: "open", stageName: "Quoted", by: DANA, age: 3, hour: 12 },
  { customer: "Priya Raman", product: "final_expense", stage: "open", stageName: "Contacted", by: SAM, age: 1, hour: 11 },
  { customer: "Eli Vasquez", product: "medicare", stage: "lost", stageName: "Closed lost", outcome: "Not interested", age: 1, hour: 10 },
  { customer: "Brenda Okonkwo", product: "final_expense", stage: "lost", stageName: "Closed lost", outcome: "Not interested", by: DANA, hour: 9 },
  { customer: "Terrence Wu", product: "final_expense", stage: "lost", stageName: "Closed lost", outcome: "Unable to reach", by: SAM, age: 4, hour: 9 },
  // Noor's team, and the unassigned Orla. None of these three may appear while Rion is viewing —
  // if one does, the rule has been lost, and that is the whole point of their being here.
  { customer: "Gloria Mendes", product: "medicare", stage: "won", stageName: "Submitted", carrier: "Humana", plan: "Advantage", monthly: 4_800, outcome: "Application submitted", by: THEO, age: 2, hour: 15 },
  { customer: "Walter Reyes", product: "final_expense", stage: "open", stageName: "Quoted", carrier: "Aetna", plan: "Whole life", by: NOOR, age: 6, hour: 12 },
  { customer: "Ada Nwosu", product: "medicare", stage: "lost", stageName: "Closed lost", outcome: "Unable to reach", by: ORLA, age: 3, hour: 10 },
];

// Three deals across three teams: Rion sees two, Dana one. A quiet day still has to prove the
// narrowing, or "quiet" and "scoped wrong" look the same.
const QUIET: Spec[] = [
  { customer: "Marcus Bell", product: "final_expense", stage: "won", stageName: "Issued", carrier: "Aetna", plan: "Whole life", monthly: 7_100, face: 1_200_000, draft: "2026-11-18", outcome: "Application submitted", hour: 14 },
  { customer: "Harold Finch", product: "medicare", stage: "open", stageName: "Quoted", by: DANA, age: 2, hour: 11 },
  { customer: "Gloria Mendes", product: "medicare", stage: "open", stageName: "Contacted", by: THEO, age: 1, hour: 13 },
];

function shift(day: string, back: number) {
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() - back);
  return moved.toISOString().slice(0, 10);
}

function specsFor(state: SampleDealFlowState): readonly Spec[] {
  if (state === "empty" || state === "error") return [];
  return state === "quiet" ? QUIET : BUSY;
}

/** The ids a viewer may see, through the same function the route calls. */
function visibleTo(role: SampleDealFlowRole): string[] {
  return visibleSubmitters({ userId: VIEWER[role].id, role }, SAMPLE_PARTNER_MEMBERS);
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
    submittedBy: spec.by ?? RION,
    submittedDay: shift(day, spec.age ?? 0),
    updatedAt: `${day}T${String(spec.hour ?? 12).padStart(2, "0")}:40:00.000Z`,
  }));
  // The boundary, where the service applies it in SQL: a partner user keeps their own submissions,
  // an admin keeps their team's and their own, and nobody keeps anybody else's.
  const visible = visibleTo(role);
  return all.filter((row) => row.submittedBy.id !== null && visible.includes(row.submittedBy.id));
}

/**
 * Who the preview's viewer is, who is on their team, and who is in the organisation but not theirs
 * to see — worked out from the same membership rows the rule reads, so the caption on the preview
 * cannot drift from the table beneath it.
 *
 * It exists because the narrowing is invisible from the outside: a page showing nine deals looks
 * the same whether three are being withheld correctly or the rule has stopped running. Saying
 * "nine of twelve" out loud is what makes the preview worth opening.
 */
export function sampleDealFlowAudience(options: { state?: SampleDealFlowState; role?: SampleDealFlowRole } = {}) {
  const { state = "busy", role = "partner_admin" } = options;
  const viewer = VIEWER[role];
  const visible = visibleTo(role);
  const specs = specsFor(state);
  return {
    viewer,
    team: visible.filter((id) => id !== viewer.id).map(nameOf),
    hidden: PEOPLE.filter((person) => !visible.includes(person.id)).map((person) => person.name),
    visibleDeals: specs.filter((spec) => visible.includes((spec.by ?? RION).id)).length,
    totalDeals: specs.length,
  };
}

export function sampleDealFlow(options: { state?: SampleDealFlowState; role?: SampleDealFlowRole; day?: string } = {}): PartnerDealFlowPayload {
  const { state = "busy", role = "partner_admin", day = SAMPLE_DAY } = options;
  const rows = rowsFrom(specsFor(state), day, role);
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
      carriers: [...new Set(rows.map((row) => row.carrier))].sort((a, b) => a === null ? -1 : b === null ? 1 : a.localeCompare(b)),
      // From the rows the boundary returned, as the service builds them — so the menu can never
      // name somebody whose deals the page would then refuse to show.
      submitters: [...new Map(rows.filter((row) => row.submittedBy.id).map((row) => [row.submittedBy.id as string, { id: row.submittedBy.id as string, name: row.submittedBy.name }])).values()]
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    capped: false,
    generatedAt: `${day}T17:00:00.000Z`,
  };
}
