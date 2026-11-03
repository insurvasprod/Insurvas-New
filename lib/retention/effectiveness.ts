/**
 * LA-5.9 (Notion sprint) · does the radar work, as plain functions.
 *
 *   Part 1  Are the predictions any good? Of the policies we scored and nobody worked, how many lapsed
 *           within the horizon, by band. The rate should fall as the band falls; if critical and low
 *           lapse alike, the score is noise and the page says so.
 *   Part 2  Does working the queue help? Policies that crossed the save-queue threshold while the
 *           holdout was on: the worked ones against the held-back ones, band by band.
 *
 * Small samples show counts, never a rate (under 20 in a band). A difference that is not yet
 * statistically meaningful says so rather than being rounded up into a claim. The holdout draw, its
 * exits and the outcome at the horizon are decided here too, so the rules are testable.
 *
 * Pure; relative imports only.
 */

import { BANDS, PLATFORM_CAPS, type Band, type Confidence } from "./constants.ts";

export const PERIODS = { quarter: 90, half: 182, year: 365, all: null } as const;
export type Period = keyof typeof PERIODS;
export const PERIOD_LABELS: Record<Period, string> = { quarter: "over the last quarter", half: "over the last six months", year: "over the last year", all: "since the holdout began" };

/** Below this many policies in a cell, the page shows the count and no percentage. */
export const MIN_RATE_SAMPLE = 20;

export const OUTCOMES = ["still_active", "lapsed", "paid_up", "reinstated"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The outcome at the horizon from the policy as the book shows it now; null when the book no longer has it (left unresolved, never guessed). */
export function outcomeOf(p: { status: string | null; lapsedOn: string | null } | undefined, reinstated: boolean, start: string, horizonEnd: string): Outcome | null {
  if (reinstated) return "reinstated";
  if (!p) return null;
  if (p.status === "paid_up") return "paid_up";
  if (p.status === "lapsed" || p.status === "not_taken" || p.status === "withdrawn" || p.status === "declined") {
    // Lapsed after the horizon: it was still paying at the horizon.
    if (p.lapsedOn && p.lapsedOn > horizonEnd) return "still_active";
    return "lapsed";
  }
  // In force now; a lapse inside the window that has since been reversed still counts as one.
  if (p.lapsedOn && p.lapsedOn >= start && p.lapsedOn <= horizonEnd) return "lapsed";
  return "still_active";
}

export type Cell = { n: number; lapsed: number; rate: number | null };
export const cell = (n: number, lapsed: number): Cell => ({ n, lapsed, rate: n >= MIN_RATE_SAMPLE ? lapsed / n : null });

export type PredictionRow = { band: Band; confidence: Confidence; weightSetVersion: number; outcome: Outcome; wasWorked: boolean; inHoldout: boolean };

/** Part 1, on unworked policies only (working a policy is meant to change its outcome). */
export function bandAccuracy(rows: PredictionRow[]) {
  const unworked = rows.filter((r) => !r.wasWorked);
  const lapsedOf = (list: PredictionRow[]) => list.filter((r) => r.outcome === "lapsed").length;
  const byBand = [...BANDS].reverse().map((band) => {
    const list = unworked.filter((r) => r.band === band);
    return { band, ...cell(list.length, lapsedOf(list)) };
  });
  const versions = [...new Set(unworked.map((r) => r.weightSetVersion))].sort((a, b) => a - b);
  const byVersion = versions.map((version) => ({
    version,
    bands: [...BANDS].reverse().map((band) => {
      const list = unworked.filter((r) => r.weightSetVersion === version && r.band === band);
      return { band, ...cell(list.length, lapsedOf(list)) };
    }),
  }));
  const byConfidence = (["high", "medium", "low"] as const).map((confidence) => ({
    confidence,
    bands: [...BANDS].reverse().map((band) => {
      const list = unworked.filter((r) => r.confidence === confidence && r.band === band);
      return { band, ...cell(list.length, lapsedOf(list)) };
    }),
  }));
  return { total: unworked.length, byBand, byVersion, byConfidence, verdict: separation(byBand) };
}

export type Verdict = "too_early" | "separates" | "noise" | "mixed";
export const VERDICT_TEXT: Record<Verdict, string> = {
  too_early: "Too few predictions have reached their horizon to judge the bands yet.",
  separates: "The bands separate: the higher the band, the more of its policies lapsed.",
  noise: "The bands do not separate: high-risk and low-risk policies lapsed at similar rates. The score is not earning its place, and the weights need fixing.",
  mixed: "The bands only partly separate: the rates do not fall steadily from critical to low.",
};

/** Whether the rate falls as the band falls, among the bands with enough policies to have a rate. */
export function separation(byBand: Array<{ band: Band; rate: number | null }>): Verdict {
  const rated = byBand.filter((b) => b.rate !== null) as Array<{ band: Band; rate: number }>;
  if (rated.length < 2) return "too_early";
  const top = rated[0];
  const bottom = rated[rated.length - 1];
  // The top band must lapse at least half again as often as the bottom one to count as separation.
  if (top.rate <= bottom.rate * 1.5 + 0.01) return "noise";
  const falling = rated.every((b, i) => i === 0 || b.rate <= rated[i - 1].rate + 0.01);
  return falling ? "separates" : "mixed";
}

/** Two proportions, pooled z. |z| ≥ 1.96 is significant at 95%. Null when either group is empty. */
export function twoProportionZ(a: { n: number; lapsed: number }, b: { n: number; lapsed: number }): number | null {
  if (!a.n || !b.n) return null;
  const p = (a.lapsed + b.lapsed) / (a.n + b.n);
  const se = Math.sqrt(p * (1 - p) * (1 / a.n + 1 / b.n));
  if (se === 0) return 0;
  return (a.lapsed / a.n - b.lapsed / b.n) / se;
}

export type DrawRow = { band: Band; selected: boolean; outcome: Outcome; wasWorked: boolean; exposureCents: number | null };

export type ArmComparison = {
  band: Band | "all";
  worked: Cell;
  holdout: Cell;
  z: number | null;
  /** Enough policies in both arms, and the difference is beyond chance at 95%. */
  meaningful: boolean;
};

/** Part 2: the worked arm (drawn, not held out, and worked) against the held-out arm, per band and overall. */
export function holdoutComparison(rows: DrawRow[]): { bands: ArmComparison[]; overall: ArmComparison } {
  const compare = (band: Band | "all", list: DrawRow[]): ArmComparison => {
    const worked = list.filter((r) => !r.selected && r.wasWorked);
    const held = list.filter((r) => r.selected);
    const w = cell(worked.length, worked.filter((r) => r.outcome === "lapsed").length);
    const h = cell(held.length, held.filter((r) => r.outcome === "lapsed").length);
    const z = twoProportionZ(h, w);
    return { band, worked: w, holdout: h, z, meaningful: w.rate !== null && h.rate !== null && z !== null && Math.abs(z) >= 1.96 };
  };
  const bands = [...BANDS].reverse().map((band) => compare(band, rows.filter((r) => r.band === band))).filter((c) => c.worked.n + c.holdout.n > 0);
  return { bands, overall: compare("all", rows) };
}

/**
 * The advance working the queue looks to have protected: the lapses avoided (the holdout's lapse rate
 * minus the worked arm's, times the policies worked) times the worked arm's average advance at risk.
 * Null when there is nothing to compare, or when working did no better than leaving alone.
 */
export function protectedAdvance(rows: DrawRow[]): number | null {
  const worked = rows.filter((r) => !r.selected && r.wasWorked);
  const held = rows.filter((r) => r.selected);
  if (!worked.length || !held.length) return null;
  const rate = (list: DrawRow[]) => list.filter((r) => r.outcome === "lapsed").length / list.length;
  const avoided = (rate(held) - rate(worked)) * worked.length;
  if (avoided <= 0) return null;
  const known = worked.filter((r) => r.exposureCents !== null);
  if (!known.length) return null;
  const average = known.reduce((sum, r) => sum + (r.exposureCents ?? 0), 0) / known.length;
  return Math.round(avoided * average);
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** The page's plain sentence, with its caveats attached — the agent reads this, not the z-score. */
export function holdoutSentence(rows: DrawRow[], period: string): string[] {
  const { overall } = holdoutComparison(rows);
  const worked = rows.filter((r) => !r.selected && r.wasWorked);
  const held = rows.filter((r) => r.selected);
  if (!held.length) return [`No policy has been held back and reached its horizon ${period}, so there is nothing to compare yet.`];
  const workedPaying = worked.filter((r) => r.outcome !== "lapsed").length;
  const heldPaying = held.filter((r) => r.outcome !== "lapsed").length;
  const lines = [
    `Of the ${worked.length.toLocaleString("en-US")} policies we flagged and you worked, ${workedPaying.toLocaleString("en-US")} were still paying at the horizon. Of the ${held.length.toLocaleString("en-US")} we held back, ${heldPaying.toLocaleString("en-US")} were.`,
  ];
  const value = protectedAdvance(rows);
  if (overall.worked.rate === null || overall.holdout.rate === null) {
    lines.push(`Too few policies to give a rate yet (${MIN_RATE_SAMPLE} are needed in each group): read these as counts, not a result.`);
  } else if (!overall.meaningful) {
    lines.push(`The difference (${pct(overall.holdout.rate)} lapsed when left alone, ${pct(overall.worked.rate)} when worked) is not yet large enough, on this many policies, to be more than chance. It is not a result yet.`);
  } else if (value !== null) {
    lines.push(`Working the queue looks worth about ${dollars(value)} of protected advance ${period} (${pct(overall.holdout.rate)} lapsed when left alone, ${pct(overall.worked.rate)} when worked).`);
  } else {
    lines.push(`Worked policies lapsed no less often than the ones left alone (${pct(overall.worked.rate)} against ${pct(overall.holdout.rate)}). If that holds, the queue is not earning its price and the weights need fixing.`);
  }
  return lines;
}

// ─── the holdout draw ────────────────────────────────────────────────────────────────────────────

/** The share actually used: never above the platform ceiling, whatever a row says. */
export const effectiveShareBp = (shareBp: number) => Math.max(0, Math.min(shareBp, PLATFORM_CAPS.holdoutCeilingBp));

export type DrawInput = { exposureCents: number | null; maxExposureCents: number; shareBp: number; roll: number; openReinstatement: boolean };

/** One draw: selected only below the exposure threshold, with known exposure, never a reinstatement case. */
export function draw(d: DrawInput): { selected: boolean; ineligible: "above_exposure" | "exposure_unknown" | null } {
  if (d.exposureCents === null) return { selected: false, ineligible: "exposure_unknown" };
  if (d.exposureCents > d.maxExposureCents) return { selected: false, ineligible: "above_exposure" };
  if (d.openReinstatement) return { selected: false, ineligible: null };
  return { selected: d.roll < effectiveShareBp(d.shareBp) / 10_000, ineligible: null };
}

/** Why a held-out policy leaves the holdout now, or null. Past due wins over everything: an emergency is never withheld. */
export function exitReason(p: { status: string | null; daysPastDue: number | null } | undefined, holdoutOn: boolean): "past_due" | "left_book" | "switched_off" | null {
  if (!p) return "left_book";
  if ((p.daysPastDue ?? 0) > 0 || p.status === "at_risk" || p.status === "lapsed") return "past_due";
  if (p.status !== "active" && p.status !== "approved_unpaid") return "left_book";
  if (!holdoutOn) return "switched_off";
  return null;
}
