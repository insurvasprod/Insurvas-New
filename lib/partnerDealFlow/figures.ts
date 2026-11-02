/**
 * The four figures above Daily deal flow's table, worked out from the day's rows.
 *
 * Pure, and separate from the read, because the arithmetic is where a figure quietly stops
 * describing the table under it: a premium counted twice, an unpriced sale counted as zero, a
 * "lost" reason taken from the whole day instead of the lost rows. Each of those is a bug nobody
 * reports, because a number on a card always looks like a fact.
 *
 * One deliberate difference from the agency's version of this page: its "oldest in progress" runs
 * over a date range, which on a single day would always be nought. Here it measures from the
 * **lead's submission** to the day on screen — a deal worked today on a lead sent five days ago is
 * genuinely five days old, and that is the thing a partner wants to see.
 */
import type { DealFlowStageType } from "../dealFlow/types.ts";
import { daysBetweenDays } from "./localDay.ts";
import type { PartnerDealFlowFigures } from "./types.ts";

export type FigureRow = {
  stageType: DealFlowStageType;
  monthlyPremiumCents: number | null;
  submittedDay: string;
  outcome: string | null;
};

const EMPTY: PartnerDealFlowFigures = {
  worked: 0,
  won: 0,
  inProgress: 0,
  lost: 0,
  wonMonthlyCents: 0,
  wonAnnualisedCents: 0,
  wonUnpriced: 0,
  oldestInProgressDays: null,
  topLostReason: null,
};

export function dealFlowFigures(rows: readonly FigureRow[], day: string): PartnerDealFlowFigures {
  if (!rows.length) return { ...EMPTY };

  const won = rows.filter((row) => row.stageType === "won");
  const open = rows.filter((row) => row.stageType === "open");
  const lost = rows.filter((row) => row.stageType === "lost");

  // A sale with no premium recorded yet is a sale. Counting it as £0 would quietly drag the
  // average down, so it is counted apart and the card can say "2 not priced yet".
  const priced = won.filter((row) => typeof row.monthlyPremiumCents === "number" && row.monthlyPremiumCents > 0);
  const wonMonthlyCents = priced.reduce((total, row) => total + (row.monthlyPremiumCents ?? 0), 0);

  // Oldest by submission, measured to the day on screen. A lead submitted after the day it was
  // worked cannot happen, but clamping at zero means a clock skew shows as "today", not "-1 days".
  const ages = open.map((row) => Math.max(0, daysBetweenDays(row.submittedDay, day)));

  return {
    worked: rows.length,
    won: won.length,
    inProgress: open.length,
    lost: lost.length,
    wonMonthlyCents,
    wonAnnualisedCents: wonMonthlyCents * 12,
    wonUnpriced: won.length - priced.length,
    oldestInProgressDays: ages.length ? Math.max(...ages) : null,
    topLostReason: commonest(lost.map((row) => row.outcome)),
  };
}

/** The value that appears most often, ignoring blanks; ties go to the one seen first. */
function commonest(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) { best = value; bestCount = count; }
  }
  return best;
}
