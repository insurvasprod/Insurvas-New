// Client-safe sample data for /design/pipeline (development only).
//
// The development database holds one lead in one stage, so the Pipeline page cannot otherwise be
// seen busy, empty, erroring, or with a submission the SLA ladder has flagged. Everything here is
// invented: the names are made up, the addresses are @example.com and the numbers are in the
// 555-01xx block reserved for fiction. No record of a real person is used.
//
// The counters are derived from the lanes with the page's own countersFromLanes, so a fixture can
// never show a board and a stat row that disagree — the contradiction this redesign exists to fix
// cannot be faked back in by accident.
import { countersFromLanes } from "./counters.ts";
import type { PartnerLane, PartnerLaneCounts } from "./lanes.ts";
import { NOBODY_CLAIMED_LABEL } from "./lanes.ts";
import { DEFAULT_AGE_THRESHOLDS } from "./view.ts";
import type { PartnerLeadDetail, PartnerLeadRow, PartnerPipelinePayload, PartnerPipelineStage } from "./types.ts";

export const SAMPLE_STATES = ["busy", "crowded", "quiet", "sla", "many", "empty", "error"] as const;
export type SampleState = (typeof SAMPLE_STATES)[number];

export const SAMPLE_ROLES = ["partner_admin", "partner_user"] as const;
export type SampleRole = (typeof SAMPLE_ROLES)[number];

export const SAMPLE_PAYOUTS = ["per_sale", "revenue_share", "none"] as const;
export type SamplePayout = (typeof SAMPLE_PAYOUTS)[number];

/**
 * Ages run backwards from the moment the preview is drawn, not from a fixed instant: pinned to a
 * date, every "2 minutes ago" lead sat in the future and the board drew a column of "1 min".
 */
export function sampleNow(): number { return Date.now(); }

const ago = (now: number, minutes: number) => new Date(now - minutes * 60_000).toISOString();

const ME = { id: "u-me", name: "Rion Test" };
const TEAM = [ME, { id: "u-dana", name: "Dana Whitfield" }, { id: "u-sam", name: "Sam Okafor" }];

const OWN_PIPELINE = "p-partner";
const OTHER_PIPELINE = "p-agency";

type StageSpec = { id: string; name: string; type: "open" | "won" | "lost"; pipelineId?: string };

const STAGES: StageSpec[] = [
  { id: "s-new", name: "New lead", type: "open" },
  { id: "s-dialing", name: "Dialing", type: "open" },
  { id: "s-transferred", name: "Transferred", type: "open" },
  { id: "s-sold", name: "Sold", type: "won" },
  { id: "s-lost", name: "Not interested", type: "lost" },
];

/** The "many" state: a second pipeline some of the partner's leads were moved into. */
const EXTRA_STAGES: StageSpec[] = [
  { id: "s-review", name: "Underwriting review", type: "open", pipelineId: OTHER_PIPELINE },
  { id: "s-issued", name: "Policy issued", type: "won", pipelineId: OTHER_PIPELINE },
  { id: "s-withdrawn", name: "Withdrawn", type: "lost", pipelineId: OTHER_PIPELINE },
];

type RowSpec = {
  customer: string;
  product: string;
  lane: PartnerLane;
  /** Minutes since the submission arrived. */
  age: number;
  stage: string;
  by?: { id: string; name: string };
  outcome?: string;
  /** The SLA ladder has told the partner nobody claimed it. */
  flagged?: boolean;
};

const NAMES = [
  "Marisol Vandenberg", "Ezra Quill", "Beatrix Olumide", "Tobias Fernsby", "Anneke Ravensworth",
  "Caspian Trelawney", "Delphine Marchetti", "Osric Nakamura", "Wilhelmina Abara", "Ignatius Pell",
  "Rosalind Thackeray", "Barnaby Osei", "Solveig Lindqvist", "Cormac Villanueva", "Henrietta Dubois",
  "Fitzwilliam Oyelaran", "Persephone Vance", "Augustin Mbeki", "Clementine Hargrove", "Lucius Fairweather",
];
const PRODUCTS = ["final_expense", "medicare", "term_life", "iul", "aca_health"];

/** A deterministic spread of leads across the lanes: the busy board. */
function busyRows(): RowSpec[] {
  const lanes: Array<{ lane: PartnerLane; stage: string; count: number; outcome?: string }> = [
    { lane: "new", stage: "s-new", count: 7 },
    { lane: "claimed", stage: "s-dialing", count: 6 },
    { lane: "verification", stage: "s-transferred", count: 3 },
    { lane: "converted", stage: "s-sold", count: 9, outcome: "Application submitted" },
    { lane: "closed", stage: "s-lost", count: 15, outcome: "Not interested" },
  ];
  const rows: RowSpec[] = [];
  let index = 0;
  for (const group of lanes) {
    for (let n = 0; n < group.count; n += 1) {
      rows.push({
        customer: NAMES[index % NAMES.length],
        product: PRODUCTS[index % PRODUCTS.length],
        lane: group.lane,
        // New leads are minutes old, worked ones hours, finished ones days: the spread the age
        // tones have to tell apart.
        age: group.lane === "new" ? 2 + n * 9 : group.lane === "closed" ? 2_000 + n * 400 : 20 + n * 95,
        stage: group.stage,
        by: TEAM[index % TEAM.length],
        outcome: group.outcome,
      });
      index += 1;
    }
  }
  return rows;
}

function rowsFor(state: SampleState): RowSpec[] {
  if (state === "empty" || state === "error") return [];
  // One lane far past the 20 a column shows, so the lane's pager can be exercised.
  if (state === "crowded") {
    return Array.from({ length: 64 }, (_, index) => ({
      customer: `${NAMES[index % NAMES.length]} ${String.fromCharCode(65 + Math.floor(index / NAMES.length))}`,
      product: PRODUCTS[index % PRODUCTS.length],
      lane: (index < 52 ? "new" : "claimed") as PartnerLane,
      age: 3 + index * 7,
      stage: index < 52 ? "s-new" : "s-dialing",
      by: TEAM[index % TEAM.length],
    }));
  }
  if (state === "quiet") return [{ customer: NAMES[0], product: "final_expense", lane: "new", age: 42, stage: "s-new", by: ME }];
  if (state === "sla") {
    return [
      { customer: NAMES[0], product: "final_expense", lane: "new", age: 8_640, stage: "s-new", by: ME, flagged: true },
      { customer: NAMES[1], product: "medicare", lane: "new", age: 420, stage: "s-new", by: TEAM[1], flagged: true },
      { customer: NAMES[2], product: "term_life", lane: "claimed", age: 95, stage: "s-dialing", by: ME },
      { customer: NAMES[3], product: "iul", lane: "converted", age: 4_300, stage: "s-sold", by: TEAM[2], outcome: "Application submitted" },
    ];
  }
  if (state === "many") {
    return [
      ...busyRows().slice(0, 12),
      { customer: NAMES[15], product: "term_life", lane: "claimed", age: 300, stage: "s-review", by: ME },
      { customer: NAMES[16], product: "iul", lane: "converted", age: 2_880, stage: "s-issued", by: TEAM[1], outcome: "Issued" },
      { customer: NAMES[17], product: "medicare", lane: "closed", age: 7_200, stage: "s-withdrawn", by: TEAM[2], outcome: "Withdrawn" },
    ];
  }
  return busyRows();
}

function stageList(state: SampleState, rows: PartnerLeadRow[]): PartnerPipelineStage[] {
  // "empty" is a partner whose agency has configured nothing yet: no stages, so the board has no
  // columns and the page offers the action that fills it. A new partner whose agency *has* stages
  // sees those columns standing empty instead — board.ts keeps them "so a new partner sees the road
  // its leads will take" — which is what the quiet state shows.
  if (state === "empty" || state === "error") return [];
  const specs = state === "many" ? [...STAGES, ...EXTRA_STAGES] : STAGES;
  return specs.map((spec, position) => ({
    id: spec.id,
    pipelineId: spec.pipelineId ?? OWN_PIPELINE,
    pipelineName: (spec.pipelineId ?? OWN_PIPELINE) === OWN_PIPELINE ? "Publisher transfers" : "Agency pipeline",
    name: spec.name,
    position,
    stageType: spec.type,
    color: "#64748b",
    isArchived: false,
    leadCount: rows.filter((row) => row.stageId === spec.id).length,
  }));
}

function laneCountsOf(rows: PartnerLeadRow[]): PartnerLaneCounts {
  const counts: PartnerLaneCounts = { new: 0, claimed: 0, verification: 0, converted: 0 };
  for (const row of rows) if (row.lane && row.lane !== "closed") counts[row.lane] += 1;
  return counts;
}

const TERMS = {
  per_sale: { payoutModel: "per_sale", rateCents: 9000, ratePctBp: null },
  revenue_share: { payoutModel: "revenue_share", rateCents: null, ratePctBp: 1250 },
  none: null,
} as const;

export function samplePipeline(options: { state: SampleState; role?: SampleRole; payout?: SamplePayout; now?: number }): PartnerPipelinePayload {
  const { state, role = "partner_admin", payout = "per_sale", now = sampleNow() } = options;
  const specs = rowsFor(state);
  const stageName = (id: string) => [...STAGES, ...EXTRA_STAGES].find((stage) => stage.id === id)?.name ?? "New";
  const stageType = (id: string) => [...STAGES, ...EXTRA_STAGES].find((stage) => stage.id === id)?.type ?? "open";

  const all: PartnerLeadRow[] = specs.map((spec, index) => ({
    // UUID-shaped so the page's own ?lead=<id> deep link accepts a sample row too.
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workItemId: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
    customer: spec.customer,
    submittedAt: ago(now, spec.age),
    updatedAt: ago(now, Math.max(0, Math.round(spec.age / 2))),
    product: spec.product,
    stageId: spec.stage,
    // A flagged submission says so in place of the agency's stage name, exactly as the service does.
    stageName: spec.flagged ? NOBODY_CLAIMED_LABEL : stageName(spec.stage),
    stageType: stageType(spec.stage),
    disposition: spec.outcome ? "application_submitted" : null,
    outcome: spec.outcome ?? null,
    submittedBy: spec.by ?? ME,
    status: spec.lane === "new" ? "unclaimed" : spec.lane === "converted" || spec.lane === "closed" ? "completed" : "claimed",
    lane: spec.lane,
  }));

  // A partner user sees only their own submissions — the same narrowing the service applies with
  // `effectiveCloserId`, so the two roles can be compared side by side on the preview.
  const rows = role === "partner_user" ? all.filter((row) => row.submittedBy.id === ME.id) : all;
  const laneCounts = laneCountsOf(rows);
  const openRows = rows.filter((row) => row.lane && row.lane !== "closed" && row.lane !== "converted");
  const oldestOpenAt = openRows.length ? openRows.reduce((oldest, row) => (row.submittedAt < oldest ? row.submittedAt : oldest), openRows[0].submittedAt) : null;

  return {
    rows,
    stages: stageList(state, rows),
    facets: {
      closers: role === "partner_user" ? [ME] : TEAM,
      products: [...new Set(rows.map((row) => row.product))],
      outcomes: [
        { key: "application_submitted", label: "Application submitted" },
        { key: "not_interested", label: "Not interested" },
      ],
    },
    counters: countersFromLanes(laneCounts, rows.filter((row) => Date.parse(row.submittedAt) >= now - 16 * 3_600_000).length),
    oldestOpenAt,
    terms: TERMS[payout],
    ageThresholds: DEFAULT_AGE_THRESHOLDS,
    laneCounts,
    total: rows.length,
    nextOffset: null,
    pageSize: 250,
    realtimeTopic: "partner-pipeline:sample",
    generatedAt: new Date(now).toISOString(),
  };
}

/** The record behind a sample row, for the detail panel. */
export function sampleDetail(row: PartnerLeadRow): PartnerLeadDetail {
  return {
    ...row,
    values: {
      first_name: row.customer.split(" ")[0],
      last_name: row.customer.split(" ").slice(1).join(" "),
      date_of_birth: "1968-04-11",
      age: 58,
      state: "IN",
      language: "English",
      tobacco: false,
      phone: "5550142317",
      email: `${row.customer.split(" ")[0].toLowerCase()}@example.com`,
      coverage_amount: 25000,
      existing_coverage: true,
      beneficiary_name: "Household member",
      beneficiary_relationship: "Spouse",
      health_notes: "Managed condition, no hospital stay in five years.",
      referral_code: "SAMPLE-2026",
    },
    timeline: [
      { type: "submitted", label: "You submitted this lead", at: row.submittedAt, detail: "Through the partner portal" },
      ...(row.lane && row.lane !== "new"
        ? [{ type: "claimed", label: "A closer claimed it", at: row.updatedAt, detail: "Picked up from the transfer inbox" }]
        : []),
      ...(row.lane === "converted"
        ? [{ type: "converted", label: "Became business", at: row.updatedAt, detail: row.outcome ?? null }]
        : []),
    ],
  };
}

/* ── The Overview's thirty days (/design/overview) ───────────────────────────────────────────── */

export const SAMPLE_OVERVIEW_STATES = ["busy", "quiet", "empty", "error"] as const;
export type SampleOverviewState = (typeof SAMPLE_OVERVIEW_STATES)[number];

/** How many a day, over 30 days, for each state. Deliberately uneven: a flat chart proves nothing. */
const DAILY: Record<Exclude<SampleOverviewState, "error">, (dayIndex: number) => number> = {
  // A working week with weekends off, growing a little over the month.
  busy: (day) => ([0, 6].includes((day + 3) % 7) ? 0 : 3 + ((day * 5) % 6) + Math.floor(day / 10)),
  quiet: (day) => (day % 9 === 0 ? 1 : 0),
  empty: () => 0,
};

const LANE_CYCLE: PartnerLane[] = ["converted", "closed", "closed", "claimed", "new", "verification", "closed", "converted"];

export type PartnerOverviewSampleData = {
  pipeline: PartnerPipelinePayload;
  /** The 30-day window the charts are drawn over; null is "the read failed", [] is "nothing sent". */
  windowRows: PartnerLeadRow[] | null;
  extras: {
    rejectedCompliance: number | null;
    alerts: Array<{ id: string; title: string; body: string; link: string; actionLabel: string }>;
    team?: { active: number; pending: number } | null;
    pulse?: { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number } | null;
  };
  statements: Array<{ periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null }> | null;
};

/**
 * The Overview on sample data. The window is built here rather than from `samplePipeline`, whose
 * rows are all hours old — a thirty-day chart drawn from them is one tall bar on today, which shows
 * nothing about whether the chart works.
 */
export function sampleOverview(options: { state: SampleOverviewState; role?: SampleRole; payout?: SamplePayout; now?: number }): PartnerOverviewSampleData {
  const { state, role = "partner_admin", payout = "per_sale", now = sampleNow() } = options;
  const pipeline = samplePipeline({ state: state === "busy" ? "busy" : state === "quiet" ? "quiet" : "empty", role, payout, now });

  let windowRows: PartnerLeadRow[] | null = [];
  if (state === "error") windowRows = null;
  else {
    const rows: PartnerLeadRow[] = [];
    for (let day = 0; day < 30; day += 1) {
      const count = DAILY[state](day);
      for (let index = 0; index < count; index += 1) {
        const lane = LANE_CYCLE[(day + index) % LANE_CYCLE.length];
        // Days back from today, at a plausible hour, so each lands in its own calendar day.
        const at = new Date(now - (29 - day) * 86_400_000);
        at.setHours(9 + (index % 8), (index * 7) % 60, 0, 0);
        rows.push({
          id: `00000000-0000-4000-7000-${String(day * 100 + index).padStart(12, "0")}`,
          workItemId: `00000000-0000-4000-7100-${String(day * 100 + index).padStart(12, "0")}`,
          customer: `Sample lead ${day}-${index}`,
          submittedAt: at.toISOString(),
          updatedAt: at.toISOString(),
          product: index % 2 ? "final_expense" : "medicare_advantage",
          stageId: "s-new",
          stageName: "New lead",
          stageType: "open",
          disposition: lane === "converted" ? "application_submitted" : null,
          outcome: lane === "converted" ? "Application submitted" : null,
          submittedBy: index % 3 === 0 ? ME : TEAM[(index % TEAM.length)],
          status: lane === "new" ? "unclaimed" : lane === "converted" || lane === "closed" ? "completed" : "claimed",
          lane,
        });
      }
    }
    // The same narrowing the service applies: a partner user sees only what they sent.
    windowRows = role === "partner_user" ? rows.filter((row) => row.submittedBy.id === ME.id) : rows;
  }

  const month = (back: number) => {
    const end = new Date(now);
    end.setDate(1);
    end.setMonth(end.getMonth() - back);
    const start = new Date(end);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { periodStart: iso(start), periodEnd: iso(end) };
  };

  return {
    pipeline,
    windowRows,
    extras: {
      rejectedCompliance: state === "empty" ? 0 : state === "quiet" ? 1 : 7,
      alerts: state === "busy"
        ? [{ id: "a1", title: "3 submissions nobody has claimed", body: "The oldest has waited 4 hours", link: "/partner/pipeline", actionLabel: "Open pipeline" }]
        : [],
      ...(role === "partner_admin"
        ? {
          team: { active: 4, pending: 1 },
          pulse: state === "empty"
            ? { averageResponseMinutes: null, responses: 0, pendingFollowUps: 0 }
            : { averageResponseMinutes: 18, responses: 64, pendingFollowUps: 2 },
        }
        : {}),
    },
    statements: role !== "partner_admin" ? null
      : state === "empty" ? []
        : state === "error" ? null
          : [0, 1, 2, 3, 4, 5].map((back) => ({
            ...month(back + 1),
            status: back === 0 ? "published" as const : "paid" as const,
            netCents: 180_000 + ((5 - back) * 46_000) + ((back % 2) * 17_500),
            paidOn: back === 0 ? null : month(back).periodStart,
          })),
  };
}

/* ── The Organization boards (/design/organization) ──────────────────────────────────────────── */

type SampleMember = { user_id: string; name: string; email: string; role: SampleRole; status: "active" | "revoked"; accepted_at: string | null; last_login_at: string | null };

export type PartnerOrganizationSampleData = {
  review: {
    rows: PartnerLeadRow[];
    /** The stretch before the window, so the change pills have something to compare against. */
    previousRows: PartnerLeadRow[];
    users: SampleMember[];
    pulse: { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number } | null;
  };
  statements: Array<{ id: string; periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null }>;
};

/**
 * Team review and Statements on sample data. The development database has one lead and no
 * published statement, so neither board can be seen with figures in it, a trend worth drawing, or
 * a team to rank. Development only.
 */
export function sampleOrganization(options: { state: SampleOverviewState; role?: SampleRole; now?: number }): PartnerOrganizationSampleData {
  const { state, role = "partner_admin", now = sampleNow() } = options;
  const current = sampleOverview({ state, role, now });
  // Two thirds of the window's volume, so "submitted" reads as a rise rather than a flat line.
  const rows = current.windowRows ?? [];
  const previousRows = rows.filter((unused, index) => index % 3 !== 0);

  const day = (back: number) => new Date(now - back * 86_400_000).toISOString();
  const users: SampleMember[] = [
    { user_id: ME.id, name: ME.name, email: "rion@example-partner.test", role: "partner_admin", status: "active", accepted_at: day(300), last_login_at: day(0) },
    { user_id: "u-dana", name: "Dana Whitfield", email: "dana@example-partner.test", role: "partner_user", status: "active", accepted_at: day(120), last_login_at: day(1) },
    { user_id: "u-sam", name: "Sam Okafor", email: "sam@example-partner.test", role: "partner_user", status: "active", accepted_at: day(40), last_login_at: day(9) },
    { user_id: "u-pending", name: "Alex Mora", email: "alex@example-partner.test", role: "partner_user", status: "active", accepted_at: null, last_login_at: null },
    { user_id: "u-gone", name: "Jo Fenwick", email: "jo@example-partner.test", role: "partner_user", status: "revoked", accepted_at: day(400), last_login_at: day(95) },
  ];

  return {
    review: {
      rows,
      previousRows,
      users: role === "partner_user" ? users.slice(0, 1) : users,
      pulse: state === "empty" ? { averageResponseMinutes: null, responses: 0, pendingFollowUps: 0 } : state === "error" ? null : { averageResponseMinutes: 18, responses: 64, pendingFollowUps: 2 },
    },
    statements: (current.statements ?? []).map((run, index) => ({ id: `run-${index}`, ...run })),
  };
}
