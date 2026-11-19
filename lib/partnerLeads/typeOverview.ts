/**
 * Pure: the figures on each partner type's Overview (roles board P1–P3), worked out from rows the
 * portal already reads — the partner-scoped pipeline window, the own pipeline's stages and the payout
 * terms in force. Nothing here reads a database or decides who sees what; the routes do.
 *
 * The rules worth holding, tested in typeOverview.test.mjs:
 *
 * - **Accepted** is a transfer the agency took: claimed, worked or closed — not still waiting, not
 *   expired, not dropped. It is the word a publisher's statement pays on (LA-7.4).
 * - **An estimate is arithmetic or nothing.** A per-item rate times a count the partner can see; a
 *   revenue share has no estimate, because it would need the agency's commission (LA-7.4: "no
 *   commission data, ever"). The rate stands alone instead.
 * - **The funnel is the partner's own pipeline**, in its stage order, never another type's stages.
 */
import { localDay, parseDay, shiftDay } from "./trend.ts";
import { isSold } from "./insights.ts";
import type { PartnerTerm } from "../partners/payout.ts";

type Row = { submittedAt: string; status: string; disposition: string | null; stageId: string; submittedBy?: { id: string | null; name: string } };
type Stage = { id: string; pipelineId: string; name: string; position: number; stageType: string; isArchived?: boolean };

/** Queue statuses that mean the agency never took the lead. */
const NOT_ACCEPTED = new Set(["unclaimed", "expired", "dropped"]);

export function isAccepted(row: Pick<Row, "status">): boolean {
  return !NOT_ACCEPTED.has(row.status);
}

/**
 * This month so far, and the same days of last month, as inclusive local days. On the 31st against a
 * 30-day month the comparison stops at the month's last day.
 */
export function monthToDate(today: string): { from: string; to: string; previousFrom: string; previousTo: string } {
  const date = parseDay(today);
  const from = `${today.slice(0, 8)}01`;
  const previousStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const previousLast = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
  const previousFrom = localDay(previousStart)!;
  const previousTo = localDay(new Date(previousStart.getFullYear(), previousStart.getMonth(), Math.min(date.getDate(), previousLast)))!;
  return { from, to: today, previousFrom, previousTo };
}

/** Rows submitted on local days from `from` to `to`, inclusive. */
export function inDays<T extends Pick<Row, "submittedAt">>(rows: readonly T[], from: string, to: string): T[] {
  return rows.filter((row) => {
    const day = localDay(row.submittedAt);
    return day !== null && day >= from && day <= to;
  });
}

export type MonthFigures = { submitted: number; accepted: number; sold: number; held: number };

export function figures(rows: readonly Row[]): MonthFigures {
  let accepted = 0;
  let sold = 0;
  let held = 0;
  for (const row of rows) {
    if (isAccepted(row)) accepted += 1;
    if (isSold(row)) sold += 1;
    if (row.status !== "unclaimed" && row.status !== "completed" && isAccepted(row)) held += 1;
  }
  return { submitted: rows.length, accepted, sold, held };
}

/**
 * How many things the partner's terms pay on, from figures it can see. Null for a revenue share (no
 * honest count) and for a model this code does not know.
 */
export function payoutBasis(model: string | null | undefined, counts: MonthFigures): number | null {
  switch (model) {
    case "per_transfer": return counts.accepted;
    case "per_lead": return counts.submitted;
    case "per_sale":
    case "per_submitted_application": return counts.sold;
    default: return null;
  }
}

/** "about $12,360", or null when it can only be the rate (a revenue share, no rate, nothing counted). */
export function estimateCents(term: PartnerTerm | null, counts: MonthFigures): number | null {
  if (!term || term.payoutModel === "revenue_share" || term.rateCents == null) return null;
  const basis = payoutBasis(term.payoutModel, counts);
  return basis === null ? null : basis * term.rateCents;
}

/** The own pipeline's stages in order: the pipeline of the first stage the read listed (board.ts puts it first). */
export function ownStages<T extends Stage>(stages: readonly T[]): T[] {
  const own = stages[0]?.pipelineId;
  if (!own) return [];
  return stages.filter((stage) => stage.pipelineId === own && !stage.isArchived).sort((a, b) => a.position - b.position);
}

export type StageCount = { id: string; name: string; stageType: string; count: number };

/** How many of `rows` sit in each of the own pipeline's stages, in stage order. */
export function stageCounts(stages: readonly Stage[], rows: readonly Pick<Row, "stageId">[]): StageCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.stageId, (counts.get(row.stageId) ?? 0) + 1);
  return ownStages(stages).map((stage) => ({ id: stage.id, name: stage.name, stageType: stage.stageType, count: counts.get(stage.id) ?? 0 }));
}

/**
 * How far leads got: each open or won stage counts the leads in it and in every later one. Lost
 * stages (Not interested, Did not qualify) are left out — a lead there did not get further.
 */
export function reach(counts: readonly StageCount[]): StageCount[] {
  const alive = counts.filter((stage) => stage.stageType !== "lost");
  let running = 0;
  const reached = alive.slice().reverse().map((stage) => {
    running += stage.count;
    return { ...stage, count: running };
  });
  return reached.reverse();
}

/** "12 of 40" as a whole percentage; null with nothing to divide by. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export type CloserRow = { id: string; name: string; sent: number; accepted: number };

/** The closer leaderboard: who sent most this month, with how many the agency accepted. */
export function closerBoard(rows: readonly Row[], max = 6): CloserRow[] {
  const byCloser = new Map<string, CloserRow>();
  for (const row of rows) {
    const id = row.submittedBy?.id ?? `name:${row.submittedBy?.name ?? "—"}`;
    const entry = byCloser.get(id) ?? { id, name: row.submittedBy?.name || "Unknown", sent: 0, accepted: 0 };
    entry.sent += 1;
    if (isAccepted(row)) entry.accepted += 1;
    byCloser.set(id, entry);
  }
  return [...byCloser.values()].sort((a, b) => b.sent - a.sent || b.accepted - a.accepted || a.name.localeCompare(b.name)).slice(0, max);
}

/** Leads and conversions per week over a window, for the marketing chart. Weeks start on `from`. */
export function weekly(rows: readonly Row[], from: string, to: string): Array<{ key: string; label: string; leads: number; converted: number }> {
  const weeks: Array<{ key: string; label: string; leads: number; converted: number }> = [];
  for (let start = from; start <= to; start = shiftDay(start, 7)) {
    const end = shiftDay(start, 6) < to ? shiftDay(start, 6) : to;
    const span = inDays(rows, start, end);
    const day = parseDay(start);
    weeks.push({ key: start, label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }), leads: span.length, converted: span.filter(isSold).length });
  }
  return weeks;
}
