/**
 * LA-5.2 (Notion sprint) · the chargeback radar's score: LA-5.1's signals → one number from 0 to 100,
 * a band, an honest confidence, the contribution of every signal, and the sentence the agent reads.
 *
 * Decision taken in the spec: a transparent weighted score, not a learned model. It works on day one,
 * it explains itself, and a wrong weight is visible and fixable. No model call, ever — this module
 * has no I/O at all.
 *
 *   score = Σ points × weight over the signals we HAVE ÷ the weight we have.
 *
 * Missing data is never quiet good news: a policy missing three signals is scored over the weight it
 * has, and the confidence says how much that was.
 *
 * Pure; relative imports only.
 */

import { SIGNALS, type Band, type Confidence, type RetentionSettings, type Signal, type Weights } from "./constants.ts";
import type { SignalRow } from "./signals.ts";

export type Contribution = {
  signal: Signal;
  /** 0–100: how bad this one sign is on its own. */
  points: number;
  /** The weight it carried (an estimated income counts half). */
  weight: number;
  /** Its share of the score; the contributions sum to the score exactly. */
  contribution: number;
  explanation: string;
};

export type RiskScore = {
  score: number;
  band: Band;
  signalsAvailable: number;
  /** Of 100: the weight the score actually rests on. */
  availableWeight: number;
  confidence: Confidence;
  contributions: Contribution[];
  explanation: string;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/** Sign 1: full points when the draft lands 0–7 days before the money; down to none 23 days before; none when it lands after. */
export function timingPoints(daysDraftBeforeIncome: number): number {
  if (daysDraftBeforeIncome > 0) return 0;
  const before = -daysDraftBeforeIncome;
  if (before <= 7) return 100;
  return clamp((100 * (23 - before)) / 16);
}

export const METHOD_POINTS = { direct_bill: 100, direct_express: 70, card: 50, bank_draft: 10 } as const;

/** Sign 3 on the policy month (month 1 = the first month): the danger window full; month 1 and the four after it partial; 13+ near zero. */
export function agePoints(monthsSinceIssue: number, settings: Pick<RetentionSettings, "dangerMonthFrom" | "dangerMonthTo">): number {
  const month = monthsSinceIssue + 1;
  if (month >= settings.dangerMonthFrom && month <= settings.dangerMonthTo) return 100;
  if (month < settings.dangerMonthFrom) return 60;
  const after = month - settings.dangerMonthTo;
  if (after <= 4) return clamp(70 - (after - 1) * 15);
  if (month <= 12) return 15;
  return 5;
}

/** Sign 4: any recovered failure scores most of the points; more failures, more points. */
export function wobblePoints(failures: number): number {
  if (failures <= 0) return 0;
  if (failures === 1) return 70;
  if (failures === 2) return 85;
  return 100;
}

/** Sign 5: premium as a share of monthly income. */
export function affordabilityPoints(pctBp: number, settings: Pick<RetentionSettings, "affordabilityLowBp" | "affordabilityHighBp">): number {
  if (pctBp < settings.affordabilityLowBp) return 15;
  if (pctBp <= settings.affordabilityHighBp) return 55;
  return 100;
}

/** Sign 6: against the agency's own average — at the average 50, 20 points of survival worse 100, 20 better 0. */
export function sourcePoints(sourceBp: number, tenantBp: number): number {
  return clamp(50 + ((tenantBp - sourceBp) / 100) * 2.5);
}

/** Sign 7: a short grace and no redraft is unforgiving; a long grace with retries forgiving. */
export function carrierPoints(graceDays: number, redraftAttempts: number | null): number {
  const base = graceDays <= 10 ? 100 : graceDays <= 30 ? 50 : 20;
  return clamp(base - (redraftAttempts && redraftAttempts > 0 ? 30 : 0));
}

const METHOD_WORDS: Record<keyof typeof METHOD_POINTS, string> = {
  direct_bill: "Paper bill in the post.",
  direct_express: "Pays by Direct Express card.",
  card: "Pays by card.",
  bank_draft: "Pays by bank draft.",
};

/** The plain sentence for one sign — no signal names, no internal numbers. */
function phrase(signal: Signal, s: SignalRow): string {
  switch (signal) {
    case "draft_timing":
      return s.daysDraftBeforeIncome !== null && s.daysDraftBeforeIncome <= 0 && s.draftDay && s.expectedIncomeDay
        ? s.daysDraftBeforeIncome === 0 && s.draftDay === s.expectedIncomeDay
          ? `Payment comes out on the ${ordinal(s.draftDay)}, the same day their money arrives.`
          : `Payment comes out on the ${ordinal(s.draftDay)}, their money arrives around the ${ordinal(s.expectedIncomeDay)}.`
        : `Payment comes out after their money arrives.`;
    case "payment_method":
      return METHOD_WORDS[s.paymentMethod ?? "bank_draft"];
    case "policy_age":
      return `Month ${(s.monthsSinceIssue ?? 0) + 1}.`;
    case "payment_wobble":
      return (s.draftFailuresCount ?? 0) === 0
        ? "No payment has bounced."
        : s.draftFailuresCount === 1
          ? s.recoveredAfterFailure === false ? "A payment bounced and has not gone through since." : "A payment bounced and went through on the retry."
          : `Payments have bounced ${s.draftFailuresCount} times.`;
    case "affordability":
      return `The premium is ${Math.round((s.premiumPctOfIncomeBp ?? 0) / 100)}% of their monthly income.`;
    case "lead_source":
      return (s.sourcePersistency9moBp ?? 0) < (s.tenantPersistency9moBp ?? 0)
        ? "Clients from this lead source keep paying less often than your average."
        : "Clients from this lead source keep paying as well as your average.";
    case "carrier":
      return `The carrier allows ${s.carrierGraceDays} days of grace${s.carrierRedraftAttempts ? " and retries a failed draft" : " and no retry"}.`;
  }
}

export function bandFor(score: number, settings: Pick<RetentionSettings, "mediumFrom" | "highFrom" | "criticalFrom">): Band {
  if (score >= settings.criticalFrom) return "critical";
  if (score >= settings.highFrom) return "high";
  if (score >= settings.mediumFrom) return "medium";
  return "low";
}

export function confidenceFor(availableWeight: number): Confidence {
  if (availableWeight >= 80) return "high";
  if (availableWeight >= 50) return "medium";
  return "low";
}

/** Largest remainder: whole-number shares that sum to `total` exactly. */
function apportion(raw: number[], total: number): number[] {
  const floors = raw.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export function scorePolicy(s: SignalRow, weights: Weights, settings: RetentionSettings): RiskScore {
  const missing = new Set(s.missing);
  const parts: Array<{ signal: Signal; points: number; weight: number }> = [];
  for (const signal of SIGNALS) {
    if (missing.has(signal)) continue;
    let points = 0;
    let weight = weights[signal];
    switch (signal) {
      case "draft_timing": points = timingPoints(s.daysDraftBeforeIncome!); break;
      case "payment_method": points = METHOD_POINTS[s.paymentMethod!]; break;
      case "policy_age": points = agePoints(s.monthsSinceIssue!, settings); break;
      case "payment_wobble": points = wobblePoints(s.draftFailuresCount ?? 0); break;
      case "affordability":
        points = affordabilityPoints(s.premiumPctOfIncomeBp!, settings);
        // An agent's estimate counts, but for less than a figure the client stated (LA-5.10).
        if (s.incomeConfidence === "estimated") weight = weight / 2;
        break;
      case "lead_source": points = sourcePoints(s.sourcePersistency9moBp!, s.tenantPersistency9moBp!); break;
      case "carrier": points = carrierPoints(s.carrierGraceDays!, s.carrierRedraftAttempts); break;
    }
    parts.push({ signal, points, weight });
  }
  const available = parts.reduce((sum, p) => sum + p.weight, 0);
  const raw = available > 0 ? parts.map((p) => (p.points * p.weight) / available) : [];
  const score = clamp(raw.reduce((a, b) => a + b, 0));
  const shares = apportion(raw, score);
  const contributions: Contribution[] = parts.map((p, i) => ({ signal: p.signal, points: p.points, weight: p.weight, contribution: shares[i], explanation: phrase(p.signal, s) }));
  const availableWeight = Math.round(available);
  return {
    score,
    band: bandFor(score, settings),
    signalsAvailable: s.signalsAvailable,
    availableWeight,
    confidence: confidenceFor(availableWeight),
    contributions,
    explanation: explain(contributions, s),
  };
}

/**
 * The sentence: the top three contributors at most, in plain words, giving the agent an opening line.
 * With nothing standing out it still says why the policy reads the way it does.
 */
export function explain(contributions: Contribution[], s: SignalRow): string {
  const top = [...contributions].filter((c) => c.contribution > 0 && c.points >= 30).sort((a, b) => b.contribution - a.contribution || SIGNALS.indexOf(a.signal) - SIGNALS.indexOf(b.signal)).slice(0, 3);
  if (top.length) return top.map((c) => c.explanation).join(" ");
  if (!contributions.length) return "Too little is known about this policy to say why.";
  const steady = [s.paymentMethod ? METHOD_WORDS[s.paymentMethod] : null, s.monthsSinceIssue !== null ? `Month ${s.monthsSinceIssue + 1}.` : null].filter(Boolean);
  return `Nothing stands out. ${steady.join(" ")}`.trim();
}
