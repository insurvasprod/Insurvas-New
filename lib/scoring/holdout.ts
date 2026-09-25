/**
 * "Is it working?" (p-app-scoring): the scored arm's contact rate against the holdout's, as a
 * difference with its 95% interval rather than a difference on its own.
 *
 * Two independent proportions, normal approximation (Wald): d = p1 − p2, se = √(p1(1−p1)/n1 +
 * p2(1−p2)/n2), interval d ± 1.96·se. It is the interval an owner can check by hand, and at the
 * sample sizes that make the answer matter (hundreds of dials a side) it agrees with the exact
 * methods to the first decimal. Below MIN_ARM dials in either arm nothing is claimed at all.
 *
 * Pure, so it is tested without a database.
 */
export const MIN_ARM = 30;

export type HoldoutArm = { served: number; contacted: number };
export type HoldoutVerdict = "better" | "worse" | "noise" | "too_few";
export type HoldoutComparison = {
  scoredPct: number | null;
  holdoutPct: number | null;
  /** Percentage points, scored minus holdout. */
  differencePts: number | null;
  interval: { low: number; high: number } | null;
  verdict: HoldoutVerdict;
};

export function compareHoldout(scored: HoldoutArm | null | undefined, holdout: HoldoutArm | null | undefined): HoldoutComparison {
  const rate = (arm: HoldoutArm | null | undefined) => (arm && arm.served > 0 ? arm.contacted / arm.served : null);
  const p1 = rate(scored);
  const p2 = rate(holdout);
  const scoredPct = p1 === null ? null : p1 * 100;
  const holdoutPct = p2 === null ? null : p2 * 100;
  if (p1 === null || p2 === null || !scored || !holdout) return { scoredPct, holdoutPct, differencePts: null, interval: null, verdict: "too_few" };
  const differencePts = (p1 - p2) * 100;
  if (scored.served < MIN_ARM || holdout.served < MIN_ARM) return { scoredPct, holdoutPct, differencePts, interval: null, verdict: "too_few" };
  const se = Math.sqrt((p1 * (1 - p1)) / scored.served + (p2 * (1 - p2)) / holdout.served) * 100;
  const interval = { low: differencePts - 1.96 * se, high: differencePts + 1.96 * se };
  const verdict: HoldoutVerdict = interval.low > 0 ? "better" : interval.high < 0 ? "worse" : "noise";
  return { scoredPct, holdoutPct, differencePts, interval, verdict };
}

export const VERDICT_CHIP: Record<HoldoutVerdict, { label: string; tone: "good" | "danger" | "warning" | "neutral" }> = {
  better: { label: "Measurably better", tone: "good" },
  worse: { label: "Measurably worse", tone: "danger" },
  noise: { label: "Not measurably", tone: "warning" },
  too_few: { label: "Too few dials", tone: "neutral" },
};

/** "+0.8 pts", "-1.9 pts" — signed, one decimal. */
export function pts(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} pts`;
}
