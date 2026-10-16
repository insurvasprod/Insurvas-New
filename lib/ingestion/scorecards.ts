/**
 * LA-4.18 (Notion sprint) · the numbers an agent has never seen about their own business, as plain
 * functions over LA-4.7's policy_current and LA-4.12's ledger: persistency at 3, 6, 9 and 13 months
 * (by count and by premium), the book by slice, placement, chargeback ratio, net commission by week,
 * and the scorecards by carrier, product, agent, agency and lead source.
 *
 * Every figure carries the keys of the rows that made it, and the drill-through lists exactly those
 * rows, so what is opened always reconciles with what was shown.
 *
 *   · Persistency is judged from issue dates, per carrier, when that carrier's files list lapsed
 *     policies as well as live ones, each with the date it ended (some policy was already lapsed the
 *     first time a file showed it): the file is then a whole history, not a list of survivors. A
 *     carrier whose files list only live policies, or lapses without their end dates, is judged on
 *     policies issued since its first file, because older ones can't be judged fairly; until it has
 *     the history, its buckets read "building", never a number from the survivors. (Owner decision 2026-10-13: the first-file rule alone left every bucket "building"
 *     until 2027 on a book with years of issue history.)
 *   · A share on fewer policies than the agency's sample size is shown as a count ("3 of 5").
 *   · Policies never in force (submitted, declined, withdrawn, approved but unpaid, not taken) are
 *     placement's subject, not persistency's.
 *
 * Pure; integer cents; shares kept as whole-number fractions until they are printed.
 */
import { addMonths } from "../ledger/compute.ts";

export const BUCKETS = [3, 6, 9, 13] as const;
export type Bucket = (typeof BUCKETS)[number];
/** The month carriers judge an agent's contract on, and the share below which they act. */
export const CONTRACT_MONTH: Bucket = 9;
export const CONTRACT_SHARE_PCT = 65;
/** The spec's default sample size; an agency can set its own (book_insight_settings). */
export const DEFAULT_MIN_SAMPLE = 10;

export const DIMENSIONS = ["carrier", "product", "agent", "agency", "source"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Slicing = Dimension | "status" | "all";
export const DIMENSION_LABELS: Record<Slicing, string> = { carrier: "Carrier", product: "Product", agent: "Agent", agency: "Agency", source: "Lead source", status: "Status", all: "Whole book" };

export type ScorePolicy = {
  key: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  clientName: string | null;
  status: string | null;
  /** The carrier's issue date, else the effective date. */
  issueDate: string | null;
  lapsedOn: string | null;
  terminationDate: string | null;
  monthsPaid: number | null;
  annualCents: number | null;
  productKey: string;
  productName: string;
  agentKey: string;
  agentName: string;
  agencyKey: string;
  agencyName: string;
  sourceKey: string;
  sourceName: string;
  /** The first carrier file this policy appeared in. */
  firstSeen: string;
  applicationId: string | null;
  /** From the ledger (null when no line for this policy is on file). */
  advancedCents: number | null;
  chargedBackCents: number | null;
  netCents: number | null;
};

const NEVER_ISSUED = new Set(["submitted", "declined", "withdrawn"]);
const NEVER_IN_FORCE = new Set([...NEVER_ISSUED, "approved_unpaid", "not_taken"]);
const IN_FORCE = new Set(["active", "at_risk", "paid_up"]);

export const issued = (p: ScorePolicy) => p.status !== null && !NEVER_ISSUED.has(p.status);
export const placed = (p: ScorePolicy) => issued(p) && (p.monthsPaid ?? 0) >= 1;
export const inForce = (p: ScorePolicy) => p.status !== null && IN_FORCE.has(p.status);

export const keyOf = (p: ScorePolicy, dim: Slicing): string =>
  dim === "all" ? "all" : dim === "carrier" ? p.carrierId : dim === "product" ? p.productKey : dim === "agent" ? p.agentKey : dim === "agency" ? p.agencyKey : dim === "source" ? p.sourceKey : p.status ?? "unknown";
export const nameOf = (p: ScorePolicy, dim: Slicing): string =>
  dim === "all" ? "Whole book" : dim === "carrier" ? p.carrierName : dim === "product" ? p.productName : dim === "agent" ? p.agentName : dim === "agency" ? p.agencyName : dim === "source" ? p.sourceName : p.status ?? "unknown";

// ─── shares ───────────────────────────────────────────────────────────────────────────────────

/** Round half up, on whole numbers: part ÷ whole as a whole percent. */
export const percentOf = (part: number, whole: number) => Math.floor((200 * part + whole) / (2 * whole));

/** A share as it is printed: a percent from the sample size up, "3 of 5" below it, "—" with nothing. */
export function shareText(part: number, whole: number, minSample: number): string {
  if (whole === 0) return "—";
  return whole >= minSample ? `${percentOf(part, whole)}%` : `${part.toLocaleString("en-US")} of ${whole.toLocaleString("en-US")}`;
}

// ─── persistency ──────────────────────────────────────────────────────────────────────────────

/** A file showed this policy go from live to lapsed (its first file listed it live). */
const seenToLapse = (p: ScorePolicy) => p.lapsedOn !== null && p.lapsedOn > p.firstSeen;

/**
 * When a lapsed policy ended: the file that showed it lapse, when one did; for a policy that was
 * already lapsed in its first file, that file's date says nothing about when it ended, so the
 * carrier's termination date is used. Without one the end is unknown (`endUnknown`).
 */
const endedOn = (p: ScorePolicy) => (p.status !== "lapsed" ? null : seenToLapse(p) ? (p.lapsedOn as string) : p.terminationDate ?? p.lapsedOn ?? p.firstSeen);
const endUnknown = (p: ScorePolicy) => p.status === "lapsed" && !seenToLapse(p) && !p.terminationDate;

/**
 * Where each carrier's history starts. `byCarrier` holds the earliest issue date for a carrier whose
 * files carry lapse history (`fromIssue`), and its first file for one whose files list only live
 * policies. `firstFile` is the agency's first carrier file.
 */
export type History = { byCarrier: Map<string, string>; fromIssue: Set<string>; firstFile: string | null };
/** A History, or one start date for every policy (a plain string, kept for callers and tests). */
export type HistoryStart = History | string | null;

export function historyStart(policies: ScorePolicy[]): History {
  const firstFile = new Map<string, string>();
  const earliestIssue = new Map<string, string>();
  const fromIssue = new Set<string>();
  const undated = new Set<string>();
  let first: string | null = null;
  for (const p of policies) {
    if (first === null || p.firstSeen < first) first = p.firstSeen;
    const seen = firstFile.get(p.carrierId);
    if (!seen || p.firstSeen < seen) firstFile.set(p.carrierId, p.firstSeen);
    if (p.issueDate && p.status && !NEVER_IN_FORCE.has(p.status)) {
      const issuedOn = earliestIssue.get(p.carrierId);
      if (!issuedOn || p.issueDate < issuedOn) earliestIssue.set(p.carrierId, p.issueDate);
    }
    // Already lapsed when a file first listed it: this carrier's files carry the lapses too. They
    // count only if the file also says when each one ended; a lapse with no end date can't be placed
    // before or after a month mark, and leaving it out keeps only the survivors (2026-10-13: one
    // carrier with 101 undated lapses read 100% at month 3).
    if (p.status === "lapsed" && !seenToLapse(p)) {
      if (p.terminationDate) fromIssue.add(p.carrierId);
      else undated.add(p.carrierId);
    }
  }
  for (const carrierId of undated) fromIssue.delete(carrierId);
  const byCarrier = new Map<string, string>();
  for (const [carrierId, seen] of firstFile) {
    const issuedOn = earliestIssue.get(carrierId);
    byCarrier.set(carrierId, fromIssue.has(carrierId) && issuedOn ? issuedOn : seen);
  }
  for (const carrierId of [...fromIssue]) if (!earliestIssue.has(carrierId)) fromIssue.delete(carrierId);
  return { byCarrier, fromIssue, firstFile: first };
}

const startFor = (start: HistoryStart, p: ScorePolicy) => (start === null || typeof start === "string" ? start : start.byCarrier.get(p.carrierId) ?? null);

/** The first day a bucket has a figure for these policies: the soonest any of their carriers' histories allows. */
function readyOnFor(policies: ScorePolicy[], month: number, start: HistoryStart): string | null {
  if (start === null || typeof start === "string") return start ? addMonths(start, month) : null;
  let soonest: string | null = null;
  const seen = new Set<string>();
  for (const p of policies) {
    if (seen.has(p.carrierId)) continue;
    seen.add(p.carrierId);
    const from = start.byCarrier.get(p.carrierId);
    if (!from) continue;
    const ready = addMonths(from, month);
    if (soonest === null || ready < soonest) soonest = ready;
  }
  return soonest;
}

export type PersistencyMember = { key: string; alive: boolean; mark: string; endedOn: string | null };
export type PersistencyCell = {
  month: Bucket;
  /** True while the book's history is shorter than the bucket: no figure exists yet. */
  building: boolean;
  /** When a figure becomes possible. */
  readyOn: string | null;
  eligible: number;
  alive: number;
  premiumEligibleCents: number;
  premiumAliveCents: number;
  /** Eligible policies with no premium on file (left out of the premium share, and counted). */
  premiumUnknown: number;
  /** Lapsed before their first file with no termination date: when they ended is unknown, so they are left out, and counted. */
  endUnknown: number;
  members: PersistencyMember[];
};

/** A book has a few hundred distinct issue days: each mark is computed once, not once per policy per slice. */
const marks = new Map<string, string>();
function markOf(issueDate: string, month: number): string {
  const key = `${issueDate}+${month}`;
  let mark = marks.get(key);
  if (mark === undefined) {
    if (marks.size > 50_000) marks.clear();
    mark = addMonths(issueDate, month);
    marks.set(key, mark);
  }
  return mark;
}

export function persistency(policies: ScorePolicy[], month: Bucket, today: string, start: HistoryStart): PersistencyCell {
  const readyOn = readyOnFor(policies, month, start);
  const cell: PersistencyCell = { month, building: !readyOn || readyOn > today, readyOn, eligible: 0, alive: 0, premiumEligibleCents: 0, premiumAliveCents: 0, premiumUnknown: 0, endUnknown: 0, members: [] };
  if (cell.building) return cell;
  for (const p of policies) {
    const from = startFor(start, p);
    if (!from || !p.issueDate || !p.status || NEVER_IN_FORCE.has(p.status) || p.issueDate < from) continue;
    const mark = markOf(p.issueDate, month);
    if (mark > today) continue;
    if (endUnknown(p)) {
      cell.endUnknown++;
      continue;
    }
    const ended = endedOn(p);
    const alive = !ended || ended > mark;
    cell.eligible++;
    if (alive) cell.alive++;
    if (p.annualCents === null) cell.premiumUnknown++;
    else {
      cell.premiumEligibleCents += p.annualCents;
      if (alive) cell.premiumAliveCents += p.annualCents;
    }
    cell.members.push({ key: p.key, alive, mark, endedOn: ended });
  }
  return cell;
}

export const persistencyAll = (policies: ScorePolicy[], today: string, start: HistoryStart) => BUCKETS.map((month) => persistency(policies, month, today, start));

/** The cell as printed, by count or by premium. */
export function persistencyText(cell: Omit<PersistencyCell, "members">, by: "count" | "premium", minSample: number): string {
  if (cell.building) return "Building";
  if (by === "count") return shareText(cell.alive, cell.eligible, minSample);
  if (cell.eligible < minSample) return shareText(cell.alive, cell.eligible, minSample);
  return cell.premiumEligibleCents > 0 ? `${percentOf(cell.premiumAliveCents, cell.premiumEligibleCents)}%` : "—";
}

// ─── slices of the book ───────────────────────────────────────────────────────────────────────

/**
 * `annualCents` is every policy's premium, lapsed ones included; `inForceCents` only the policies in
 * force. The book's headline is the in-force figure (2026-10-13): a premium printed beside "1,169 of
 * 3,971 in force" read as the live book while it counted the lapsed ones too.
 */
export type Slice = { key: string; name: string; policies: number; inForce: number; annualCents: number; inForceCents: number; annualUnknown: number; members: string[] };

export function slices(policies: ScorePolicy[], dim: Slicing): Slice[] {
  const out = new Map<string, Slice>();
  for (const p of policies) {
    const key = keyOf(p, dim);
    const s = out.get(key) ?? { key, name: nameOf(p, dim), policies: 0, inForce: 0, annualCents: 0, inForceCents: 0, annualUnknown: 0, members: [] };
    s.policies++;
    if (inForce(p)) {
      s.inForce++;
      s.inForceCents += p.annualCents ?? 0;
    }
    if (p.annualCents === null) s.annualUnknown++;
    else s.annualCents += p.annualCents;
    s.members.push(p.key);
    out.set(key, s);
  }
  return [...out.values()].sort((a, b) => b.annualCents - a.annualCents || b.policies - a.policies || a.name.localeCompare(b.name));
}

// ─── placement ────────────────────────────────────────────────────────────────────────────────

export type Submission = { applicationId: string; carrierId: string; submittedOn: string };
export type Placement = {
  issued: string[];
  placed: string[];
  /** Issued and never paid: the gap between the number agents quote and the number that pays. */
  notPlaced: string[];
  /** LA-3 submissions in the period (null when the agency has none), and how many of them issued. */
  submitted: number | null;
  submittedIssued: number | null;
};

const inPeriod = (day: string | null, from: string, to: string) => day !== null && day >= from && day <= to;

export function placement(policies: ScorePolicy[], submissions: Submission[], from: string, to: string): Placement {
  const period = policies.filter((p) => inPeriod(p.issueDate, from, to));
  const issuedRows = period.filter(issued);
  const apps = new Set(submissions.filter((s) => inPeriod(s.submittedOn, from, to)).map((s) => s.applicationId));
  const issuedApps = new Set(policies.filter((p) => issued(p) && p.applicationId && apps.has(p.applicationId)).map((p) => p.applicationId));
  return {
    issued: issuedRows.map((p) => p.key),
    placed: issuedRows.filter(placed).map((p) => p.key),
    notPlaced: issuedRows.filter((p) => !placed(p)).map((p) => p.key),
    submitted: apps.size ? apps.size : null,
    submittedIssued: apps.size ? issuedApps.size : null,
  };
}

// ─── chargeback ratio ─────────────────────────────────────────────────────────────────────────

/**
 * `chargedBackCents` counts only chargebacks on policies whose advance is on file, so the ratio is a
 * true share and cannot pass 100%. A chargeback on a policy with no advance on file claws back an
 * advance paid before the agency's first statement: it is real money, but it has no denominator here,
 * so it is kept apart in `earlierCents` (2026-10-13: the whole book read 148%).
 */
export type ChargebackRow = { key: string; name: string; advancedCents: number; chargedBackCents: number; advancedPolicies: number; members: string[]; earlierCents: number; earlierMembers: string[] };

const advancedOf = (p: ScorePolicy) => Math.max(0, p.advancedCents ?? 0);
const chargedBackOf = (p: ScorePolicy) => Math.abs(Math.min(0, p.chargedBackCents ?? 0));

/** Chargebacks as a share of advances, per slice; a slice with no advance on file has no ratio. */
export function chargebacks(policies: ScorePolicy[], dim: Dimension | "all"): ChargebackRow[] {
  const out = new Map<string, ChargebackRow>();
  for (const p of policies) {
    const advanced = advancedOf(p);
    const back = chargedBackOf(p);
    if (!advanced && !back) continue;
    const key = keyOf(p, dim);
    const row = out.get(key) ?? { key, name: nameOf(p, dim), advancedCents: 0, chargedBackCents: 0, advancedPolicies: 0, members: [], earlierCents: 0, earlierMembers: [] };
    if (advanced) {
      row.advancedCents += advanced;
      row.chargedBackCents += back;
      row.advancedPolicies++;
      row.members.push(p.key);
    } else {
      row.earlierCents += back;
      row.earlierMembers.push(p.key);
    }
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.chargedBackCents - a.chargedBackCents || b.earlierCents - a.earlierCents || a.name.localeCompare(b.name));
}

/** "12%" on the sample size of advanced policies; below it the two amounts are shown instead. */
export function chargebackText(row: Pick<ChargebackRow, "advancedCents" | "chargedBackCents" | "advancedPolicies">, minSample: number): string | null {
  if (!row.advancedCents || row.advancedPolicies < minSample) return null;
  return `${percentOf(row.chargedBackCents, row.advancedCents)}%`;
}

// ─── net commission by week ───────────────────────────────────────────────────────────────────

export type WeekTotal = { week: string; type: string; cents: number; entries: number };
export const WEEK_PARTS = ["advance", "earned", "override", "chargeback", "fee", "advance_interest", "other"] as const;
export type WeekRow = { week: string; parts: Record<(typeof WEEK_PARTS)[number], number>; heldCents: number; netCents: number; entries: number };

/** Advances plus earned (and overrides), less chargebacks, fees and advance interest. Held money is shown apart: it isn't paid. */
export function netByWeek(totals: WeekTotal[]): WeekRow[] {
  const out = new Map<string, WeekRow>();
  for (const t of totals) {
    const row = out.get(t.week) ?? { week: t.week, parts: { advance: 0, earned: 0, override: 0, chargeback: 0, fee: 0, advance_interest: 0, other: 0 }, heldCents: 0, netCents: 0, entries: 0 };
    row.entries += t.entries;
    if (t.type === "held") row.heldCents += t.cents;
    else {
      const part = (WEEK_PARTS as readonly string[]).includes(t.type) ? (t.type as (typeof WEEK_PARTS)[number]) : "other";
      row.parts[part] += t.cents;
      row.netCents += t.cents;
    }
    out.set(t.week, row);
  }
  return [...out.values()].sort((a, b) => b.week.localeCompare(a.week));
}

/** The Monday of a day's week (UTC), as the ledger's week totals are keyed (date_trunc('week')). */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Every week of the window, newest first, a week with no ledger line included as an empty row
 * (`entries: 0`), so "the last 13 weeks" lists 13 weeks rather than only the ones with money in them.
 * The window is the store's: the 13 weeks back from today (2026-10-13).
 */
export function everyWeek(rows: WeekRow[], today: string, weeks = 13): WeekRow[] {
  const byWeek = new Map(rows.map((row) => [row.week, row]));
  const back = new Date(`${today}T00:00:00Z`);
  back.setUTCDate(back.getUTCDate() - 7 * weeks);
  const out: WeekRow[] = [];
  for (let week = mondayOf(today); week >= mondayOf(back.toISOString().slice(0, 10)); ) {
    out.push(byWeek.get(week) ?? { week, parts: { advance: 0, earned: 0, override: 0, chargeback: 0, fee: 0, advance_interest: 0, other: 0 }, heldCents: 0, netCents: 0, entries: 0 });
    const prev = new Date(`${week}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 7);
    week = prev.toISOString().slice(0, 10);
  }
  // Any week the ledger returned outside the window (it should not) is still shown, never dropped.
  for (const row of rows) if (!out.some((r) => r.week === row.week)) out.push(row);
  return out.sort((a, b) => b.week.localeCompare(a.week));
}

// ─── scorecards ───────────────────────────────────────────────────────────────────────────────

export type Scorecard = {
  key: string;
  name: string;
  policies: number;
  inForce: number;
  annualCents: number;
  issued: number;
  placed: number;
  contract: PersistencyCell;
  advancedCents: number;
  chargedBackCents: number;
  advancedPolicies: number;
  netCents: number;
  /** Whether any of these policies has a ledger line: without one, net commission is unknown, not $0. */
  netKnown: boolean;
  members: string[];
  /** Lead source only: spend in the period, the sales it bought, and the true cost per sale. */
  spendCents?: number | null;
  sales?: number;
  salesMembers?: string[];
};

export function scorecards(policies: ScorePolicy[], dim: Dimension, ctx: { today: string; start: HistoryStart; from: string; to: string; spend?: Map<string, number> }): Scorecard[] {
  const groups = new Map<string, ScorePolicy[]>();
  for (const p of policies) {
    const key = keyOf(p, dim);
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const issuedRows = members.filter(issued);
    const sales = members.filter((p) => issued(p) && inPeriod(p.issueDate, ctx.from, ctx.to));
    const card: Scorecard = {
      key,
      name: nameOf(members[0], dim),
      policies: members.length,
      inForce: members.filter(inForce).length,
      annualCents: members.reduce((sum, p) => sum + (p.annualCents ?? 0), 0),
      issued: issuedRows.length,
      placed: issuedRows.filter(placed).length,
      contract: persistency(members, CONTRACT_MONTH, ctx.today, ctx.start),
      advancedCents: members.reduce((sum, p) => sum + advancedOf(p), 0),
      // Matched to an advance on file, as the chargeback ratio counts them.
      chargedBackCents: members.reduce((sum, p) => sum + (advancedOf(p) ? chargedBackOf(p) : 0), 0),
      advancedPolicies: members.filter((p) => (p.advancedCents ?? 0) > 0).length,
      netCents: members.reduce((sum, p) => sum + (p.netCents ?? 0), 0),
      netKnown: members.some((p) => p.netCents !== null),
      members: members.map((p) => p.key),
    };
    if (dim === "source") {
      card.spendCents = ctx.spend?.has(key) ? (ctx.spend.get(key) as number) : null;
      card.sales = sales.length;
      card.salesMembers = sales.map((p) => p.key);
    }
    return card;
  }).sort((a, b) => b.annualCents - a.annualCents || b.policies - a.policies || a.name.localeCompare(b.name));
}

/** Rounded to whole cents, half up: a × b ÷ c on whole numbers. */
const mulDiv = (a: number, b: number, c: number) => Math.floor((2 * a * b + c) / (2 * c));

/** Spend ÷ sales. */
export const costPerSale = (spendCents: number | null | undefined, sales: number | undefined) => (spendCents == null || !sales ? null : mulDiv(spendCents, 1, sales));

/**
 * The true cost per sale: spend ÷ (sales × month-9 persistency), from the counts, not a rounded
 * percent. Null while the share is building, under the sample size, or nobody survived.
 */
export function trueCostPerSale(spendCents: number | null | undefined, sales: number | undefined, cell: Pick<PersistencyCell, "building" | "eligible" | "alive">, minSample: number): number | null {
  if (spendCents == null || !sales || cell.building || cell.eligible < minSample || cell.alive === 0) return null;
  return mulDiv(spendCents, cell.eligible, sales * cell.alive);
}

/** Whole dollars, as the scorecard prints a cost per sale. */
export const wholeDollars = (cents: number) => `$${Math.floor((cents + 50) / 100).toLocaleString("en-US")}`;

// ─── drill-through ────────────────────────────────────────────────────────────────────────────

/**
 * What a figure is, written into its link: `kind~part~part`. Each part is URI-encoded, so a product
 * or source name can hold any character.
 */
export type Drill =
  | { kind: "book"; dim: Slicing; key: string; live?: boolean }
  | { kind: "persistency"; month: Bucket; dim: Dimension | "all"; key: string }
  | { kind: "placement"; set: "issued" | "placed" | "not_placed" }
  | { kind: "chargeback"; dim: Dimension | "all"; key: string }
  | { kind: "sales"; key: string }
  | { kind: "week"; week: string };

export function drillParam(d: Drill): string {
  const parts: string[] =
    d.kind === "book" ? [d.dim, d.key, ...(d.live ? ["live"] : [])]
    : d.kind === "persistency" ? [String(d.month), d.dim, d.key]
    : d.kind === "placement" ? [d.set]
    : d.kind === "chargeback" ? [d.dim, d.key]
    : d.kind === "sales" ? [d.key]
    : [d.week];
  // encodeURIComponent leaves "~" alone, so it is escaped by hand: a key may hold one.
  return [d.kind, ...parts].map((part) => encodeURIComponent(part).replaceAll("~", "%7E")).join("~");
}

const SLICINGS = [...DIMENSIONS, "status", "all"] as const;
export function readDrill(param: string | undefined | null): Drill | null {
  if (!param) return null;
  const [kind, ...rest] = param.split("~").map((part) => { try { return decodeURIComponent(part); } catch { return ""; } });
  if (kind === "book" && rest.length === 2 && (SLICINGS as readonly string[]).includes(rest[0])) return { kind, dim: rest[0] as Slicing, key: rest[1] };
  if (kind === "book" && rest.length === 3 && rest[2] === "live" && (SLICINGS as readonly string[]).includes(rest[0])) return { kind, dim: rest[0] as Slicing, key: rest[1], live: true };
  if (kind === "persistency" && rest.length === 3 && (BUCKETS as readonly number[]).includes(Number(rest[0])) && [...DIMENSIONS, "all"].includes(rest[1])) return { kind, month: Number(rest[0]) as Bucket, dim: rest[1] as Dimension | "all", key: rest[2] };
  if (kind === "placement" && rest.length === 1 && ["issued", "placed", "not_placed"].includes(rest[0])) return { kind, set: rest[0] as "issued" | "placed" | "not_placed" };
  if (kind === "chargeback" && rest.length === 2 && [...DIMENSIONS, "all"].includes(rest[0])) return { kind, dim: rest[0] as Dimension | "all", key: rest[1] };
  if (kind === "sales" && rest.length === 1) return { kind, key: rest[0] };
  if (kind === "week" && rest.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(rest[0])) return { kind, week: rest[0] };
  return null;
}

export type DrillRow = { key: string; note: string; tone: "good" | "danger" | "plain" };
export type DrillSet = { title: string; figure: string; rows: DrillRow[] };

/**
 * The rows behind a policy figure, computed by the same function that made the figure (so the count
 * is the figure's own). The week drill reads ledger entries instead and is answered by the store.
 */
export function drillRows(policies: ScorePolicy[], d: Exclude<Drill, { kind: "week" }>, ctx: { today: string; start: HistoryStart; from: string; to: string; minSample: number }): DrillSet | null {
  const plain = (keys: string[], note: (p: ScorePolicy) => string) => {
    const byKey = new Map(policies.map((p) => [p.key, p]));
    return keys.map((key) => byKey.get(key)).filter((p): p is ScorePolicy => Boolean(p)).map((p) => ({ key: p.key, note: note(p), tone: "plain" as const }));
  };
  if (d.kind === "book") {
    const slice = slices(policies, d.dim).find((s) => s.key === d.key);
    if (!slice) return null;
    if (d.live) {
      // The in-force premium's rows: the policies in force, whose premiums sum to the figure.
      const byKey = new Map(policies.map((p) => [p.key, p]));
      const live = slice.members.filter((key) => { const p = byKey.get(key); return p ? inForce(p) : false; });
      return { title: `${DIMENSION_LABELS[d.dim]}: ${slice.name} · in force`, figure: `${centsText(slice.inForceCents)} on ${live.length.toLocaleString("en-US")} ${live.length === 1 ? "policy" : "policies"} in force`, rows: plain(live, (p) => (p.annualCents === null ? "In force · no premium on file" : `In force · ${centsText(p.annualCents)} a year`)) };
    }
    return { title: `${DIMENSION_LABELS[d.dim]}: ${slice.name}`, figure: `${slice.policies.toLocaleString("en-US")} ${slice.policies === 1 ? "policy" : "policies"}`, rows: plain(slice.members, (p) => (inForce(p) ? "In force" : p.status ?? "Unknown")) };
  }
  if (d.kind === "persistency") {
    const scope = d.dim === "all" ? policies : policies.filter((p) => keyOf(p, d.dim as Dimension) === d.key);
    const cell = persistency(scope, d.month, ctx.today, ctx.start);
    if (cell.building) return null;
    const name = d.dim === "all" ? "Whole book" : nameOf(scope[0] ?? policies[0], d.dim);
    return {
      title: `Month ${d.month} persistency · ${name}`,
      figure: `${cell.alive} of ${cell.eligible} still in force`,
      rows: cell.members.map((m) => ({ key: m.key, note: m.alive ? `In force at month ${d.month} (${m.mark})` : `Lapsed ${m.endedOn}, before month ${d.month} (${m.mark})`, tone: m.alive ? "good" : "danger" })),
    };
  }
  if (d.kind === "placement") {
    const pl = placement(policies, [], ctx.from, ctx.to);
    const keys = d.set === "issued" ? pl.issued : d.set === "placed" ? pl.placed : pl.notPlaced;
    const title = d.set === "issued" ? "Issued in the period" : d.set === "placed" ? "Placed: issued and paid at least once" : "Issued but never paid";
    return { title, figure: `${keys.length.toLocaleString("en-US")} ${keys.length === 1 ? "policy" : "policies"}`, rows: plain(keys, (p) => (placed(p) ? `Paid ${p.monthsPaid} ${p.monthsPaid === 1 ? "month" : "months"}` : "No payment on file")) };
  }
  if (d.kind === "chargeback") {
    const row = chargebacks(policies, d.dim).find((r) => r.key === d.key);
    if (!row) return null;
    return {
      title: `Chargebacks · ${row.name}`,
      figure: chargebackText(row, ctx.minSample) ?? `${centsText(row.chargedBackCents)} of ${centsText(row.advancedCents)} advanced`,
      // The ratio's own rows first; then, apart, the chargebacks on advances paid before the first statement.
      rows: [
        ...plain(row.members, (p) => `Advanced ${centsText(advancedOf(p))}, charged back ${centsText(chargedBackOf(p))}`),
        ...plain(row.earlierMembers, (p) => `Charged back ${centsText(chargedBackOf(p))} on an advance paid before your first statement · not in the ratio`),
      ],
    };
  }
  const card = scorecards(policies, "source", ctx).find((c) => c.key === d.key);
  if (!card) return null;
  return { title: `Sales in the period · ${card.name}`, figure: `${card.sales ?? 0} ${card.sales === 1 ? "sale" : "sales"}`, rows: plain(card.salesMembers ?? [], () => "Issued in the period") };
}

/** $1,234.56 from whole cents, without floating point. */
export function centsText(cents: number): string {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "−" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
}
