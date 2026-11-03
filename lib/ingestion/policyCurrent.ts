/**
 * LA-4.7 (Notion sprint) · the computed fields of policy_current, as plain functions.
 *
 * refresh_policy_current (20261008160000) is what writes the table; this is the same arithmetic,
 * kept here so it is unit-tested and so a screen can explain a number. The migration rehearsal
 * checks the two agree, case by case.
 *
 *   · days past due is measured from the paid-to date, never from the file's date — so a monthly
 *     feed still gives a countdown that moves every day.
 *   · no carrier rule, no countdown: null, never zero and never a default (LA-4.17).
 *   · the risk band is derived from observed facts only; it is not a prediction.
 *
 * Pure; relative imports only.
 */
import { daysUntilCarrierCloses, type RuleType } from "./carrierRules.ts";

export const PREMIUM_MODES = ["monthly", "quarterly", "semiannual", "annual"] as const;
export type PremiumMode = (typeof PREMIUM_MODES)[number];
const PAYMENTS_A_YEAR: Record<PremiumMode, number> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

export const RISK_BANDS = ["none", "watch", "at_risk", "critical"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/** Premium a year: the modal premium times the payments a year. Null without a mode or a premium. */
export function annualisedPremiumCents(premiumCents: number | null, mode: string | null): number | null {
  if (premiumCents === null || !mode || !(mode in PAYMENTS_A_YEAR)) return null;
  return premiumCents * PAYMENTS_A_YEAR[mode as PremiumMode];
}

/** Days since the paid-to date as of a day, floored at 0. Null without a paid-to date. */
export function daysPastDue(asOf: string, paidToDate: string | null): number | null {
  if (!paidToDate) return null;
  return Math.max(0, dayNumber(asOf) - dayNumber(paidToDate));
}

/** Whole months from the effective date to the paid-to date (Postgres `age`), 0 before any payment. */
export function monthsPaid(effectiveDate: string | null, paidToDate: string | null): number | null {
  if (!effectiveDate || !paidToDate) return null;
  if (paidToDate <= effectiveDate) return 0;
  const [ey, em, ed] = effectiveDate.split("-").map(Number);
  const [py, pm, pd] = paidToDate.split("-").map(Number);
  return (py - ey) * 12 + (pm - em) - (pd < ed ? 1 : 0);
}

/** Which save window applies: the first payment's until a payment is on record, then ongoing. */
export function ruleTypeFor(effectiveDate: string | null, paidToDate: string | null): Extract<RuleType, "first_payment" | "ongoing_payment"> {
  return !paidToDate || (effectiveDate !== null && paidToDate <= effectiveDate) ? "first_payment" : "ongoing_payment";
}

/** The carrier's status, except `active` past the rule's grace is `at_risk` — what LA-4.5's map would say. */
export function effectiveStatus(reported: string | null, dpd: number | null, graceDays: number | null): string | null {
  return reported === "active" && graceDays !== null && dpd !== null && dpd > graceDays ? "at_risk" : reported;
}

/**
 * Days late. Normally from the paid-to date. An approved policy whose first premium has not been
 * drawn (approved_unpaid, nothing paid past the effective date) owes its first draft on the
 * effective date, so it is late from then — the first-payment window counts from it. Other statuses
 * with no paid-to date stay null: a carrier that sends none gives no countdown, never an invented one.
 */
export function daysLate(asOf: string, status: string | null, effectiveDate: string | null, paidToDate: string | null): number | null {
  if (status === "approved_unpaid" && effectiveDate && (!paidToDate || paidToDate <= effectiveDate)) return daysPastDue(asOf, effectiveDate);
  return daysPastDue(asOf, paidToDate);
}

/** The statuses a carrier window counts down for: in force, or approved and waiting for its first draft. */
const COUNTED = new Set(["active", "at_risk", "approved_unpaid"]);

/** Days left before the carrier closes it — only while it is in force (or awaiting its first draft), only with a rule. */
export function countdown(status: string | null, windowDays: number | null, dpd: number | null): number | null {
  if (!COUNTED.has(status ?? "")) return null;
  if (dpd === null) return null;
  return daysUntilCarrierCloses({ windowDays }, dpd);
}

export function inClawbackWindow(months: number | null, clawbackMonths: number | null): boolean | null {
  return months === null || clawbackMonths === null ? null : months < clawbackMonths;
}

/**
 * The band, from what was observed: status, days past due, the carrier's window, the clawback window.
 * An approved policy waiting for its first draft is watched once the draft is late, at risk past the
 * first-payment grace, and critical once the carrier's first-payment window has run out.
 */
export function riskBand(input: { status: string | null; dpd: number | null; untilCloses: number | null; inClawback: boolean | null; graceDays?: number | null }): RiskBand {
  if (input.status === "at_risk") return input.inClawback === true || (input.untilCloses !== null && input.untilCloses <= 0) ? "critical" : "at_risk";
  if (input.status === "approved_unpaid") {
    if (input.untilCloses !== null && input.untilCloses <= 0) return "critical";
    if (input.graceDays != null && (input.dpd ?? 0) > input.graceDays) return "at_risk";
    return (input.dpd ?? 0) > 0 ? "watch" : "none";
  }
  if (input.status === "active" && (input.dpd ?? 0) > 0) return "watch";
  return "none";
}

export type CurrentInput = {
  asOf: string;
  status: string | null;
  paidToDate: string | null;
  effectiveDate: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  rule: { windowDays: number | null; graceDays: number | null } | null;
  clawbackMonths: number | null;
};

/** Every computed field for one policy, in the order refresh_policy_current computes them. */
export function computeCurrent(input: CurrentInput) {
  const dpd = daysLate(input.asOf, input.status, input.effectiveDate, input.paidToDate);
  const months = monthsPaid(input.effectiveDate, input.paidToDate);
  const status = effectiveStatus(input.status, dpd, input.rule?.graceDays ?? null);
  const untilCloses = countdown(status, input.rule?.windowDays ?? null, dpd);
  const inClawback = inClawbackWindow(months, input.clawbackMonths);
  return {
    ruleType: ruleTypeFor(input.effectiveDate, input.paidToDate),
    status,
    annualisedPremiumCents: annualisedPremiumCents(input.premiumCents, input.premiumMode),
    daysPastDue: dpd,
    daysUntilCarrierCloses: untilCloses,
    monthsPaid: months,
    inClawbackWindow: inClawback,
    riskBand: riskBand({ status, dpd, untilCloses, inClawback, graceDays: input.rule?.graceDays ?? null }),
  };
}

/**
 * The line under a policy's risk (LA-4.11 policy page): the countdown when there is one, else how
 * late it is, else what is actually known — never "paid up to date" for a policy whose first premium
 * has not been drawn, or one the carrier sends no paid-to date for.
 */
export function riskFootnote(p: { status: string | null; daysLeft: number | null; daysPastDue: number | null; paidTo: string | null }): string {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (p.daysLeft !== null) return p.daysLeft <= 0 ? "the carrier's window has run out" : `${days(p.daysLeft)} until the carrier closes it`;
  if (p.status === "approved_unpaid") return p.daysPastDue ? `first premium not drawn, ${days(p.daysPastDue)} late; no first-payment window set for this carrier` : "first premium not drawn yet";
  if (p.daysPastDue) return `${days(p.daysPastDue)} past due`;
  if (!p.paidTo) return "no paid-to date from the carrier";
  return "paid up to date";
}

/**
 * LA-4.10 · persistency needs history. One imported file is one snapshot, so until there are files
 * from enough different months the figure is "building", never a number computed from too little.
 */
export const PERSISTENCY_MONTHS_NEEDED = 3;
export function persistencyStatus(monthsWithFiles: number): { ready: boolean; label: string } {
  const months = Math.max(0, Math.floor(monthsWithFiles));
  if (months >= PERSISTENCY_MONTHS_NEEDED) return { ready: true, label: "ready" };
  return { ready: false, label: `building — needs ${PERSISTENCY_MONTHS_NEEDED} months of files (${months} so far)` };
}

/**
 * LA-4.10 · money we do not know reads as unknown. An imported policy's unearned advance needs the
 * commission statements; until they arrive it is null, and null must never print as $0.00 — zero
 * would say "nothing at risk", the opposite of the truth.
 */
export function moneyOrUnknown(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Unknown";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}