/**
 * LA-4.13 (Notion sprint) · expected commission, as plain functions: when the carrier's pay trigger
 * occurred, which rate applies, how sure we are, and the expected figure.
 *
 * Integer cents and integer basis points only. "No rate card" is a statement of its own and never a
 * zero: a policy we cannot price has no expected figure, and says why.
 */

export type Trigger = "on_issue" | "on_first_draft";
export type Confidence = "exact" | "assumed_level" | "no_rate_card";

export const TRIGGER_LABELS: Record<Trigger, string> = { on_issue: "On issue", on_first_draft: "On the first draft" };
export const CONFIDENCE_LABELS: Record<Confidence, string> = { exact: "From your rate card", assumed_level: "Contract level assumed", no_rate_card: "No rate entered" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole years between a date of birth and a day, as an insurer counts age last birthday. */
export function ageOn(dob: string | null, day: string | null): number | null {
  if (!dob || !day || !DAY.test(dob.slice(0, 10)) || !DAY.test(day)) return null;
  const [by, bm, bd] = dob.slice(0, 10).split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

export type TriggerInput = { issueDate: string | null; issuedOn: string | null; effectiveDate: string | null; paidTo: string | null; firstSeenDate: string | null };

/**
 * The day the pay trigger occurred, or null if it hasn't. On issue: the issue date (or, for a
 * carrier that sends none, the first file that showed it issued). On the first draft: the first
 * file in which the paid-to date moved past the effective date; a policy first seen already paid
 * past its effective date had drafted by its first file.
 */
export function triggerOccurredOn(trigger: Trigger, policy: TriggerInput, firstDraftSeen: string | null): string | null {
  if (trigger === "on_issue") return policy.issueDate ?? policy.issuedOn ?? null;
  if (firstDraftSeen) return firstDraftSeen;
  if (policy.paidTo && policy.effectiveDate && policy.paidTo > policy.effectiveDate) return policy.firstSeenDate;
  return null;
}

/**
 * From the paid-to changes of one policy (oldest first), the first file date the paid-to moved past
 * the effective date. A change that starts already past it means the policy had drafted before any
 * change was seen: null, so the trigger falls back to the first file that showed it (triggerOccurredOn).
 */
export function firstDraftDate(changes: Array<{ oldValue?: string | null; newValue: string | null; toSnapshotDate: string }>, effectiveDate: string | null): string | null {
  if (!effectiveDate) return null;
  for (const change of changes) {
    if (change.oldValue && change.oldValue > effectiveDate) return null;
    if (change.newValue && change.newValue > effectiveDate) return change.toSnapshotDate;
  }
  return null;
}

export type Band = { id: string; ageMin: number; ageMax: number; rateBp: number };
export type Schedule = { id: string; productCode: string; levelBp: number; policyYear: number; appliesOnward: boolean; rateBp: number; effectiveFrom: string; bands: Band[] };
export type RateOutcome =
  | { confidence: "exact" | "assumed_level"; schedule: Schedule; band: Band | null; rateBp: number; levelBp: number; reason: string | null }
  | { confidence: "no_rate_card"; reason: string };

/**
 * The rate for a product family, contract level, policy year and issue age, in force on a day.
 * Forward-only: a rate entered with a later date does not apply to an earlier trigger.
 */
export function resolveRate(input: { schedules: Schedule[]; family: string | null; carrierProductCode: string | null; levelBp: number | null; policyYear: number; onDay: string; age: number | null }): RateOutcome {
  if (!input.family) return { confidence: "no_rate_card", reason: input.carrierProductCode ? `the carrier's product "${input.carrierProductCode}" is not matched to a product family` : "the carrier's file gives no product" };
  const inForce = input.schedules.filter((s) => s.productCode === input.family && (s.policyYear === input.policyYear || (s.appliesOnward && s.policyYear <= input.policyYear)) && s.effectiveFrom <= input.onDay);
  if (!inForce.length) return { confidence: "no_rate_card", reason: `no ${input.family.replaceAll("_", " ")} rate for policy year ${input.policyYear} on ${input.onDay}` };
  const latest = (rows: Schedule[]) => rows.reduce((best, row) => (row.effectiveFrom > best.effectiveFrom || (row.effectiveFrom === best.effectiveFrom && row.policyYear > best.policyYear) ? row : best));
  let schedule: Schedule;
  let confidence: "exact" | "assumed_level";
  if (input.levelBp !== null) {
    const atLevel = inForce.filter((s) => s.levelBp === input.levelBp);
    if (!atLevel.length) return { confidence: "no_rate_card", reason: `no rate at your contract level (${input.levelBp / 100}%)` };
    schedule = latest(atLevel);
    confidence = "exact";
  } else {
    const levels = [...new Set(inForce.map((s) => s.levelBp))];
    if (levels.length !== 1) return { confidence: "no_rate_card", reason: "your contract level with this carrier isn't set, and rates exist for several levels" };
    schedule = latest(inForce);
    confidence = "assumed_level";
  }
  const band = input.age === null ? null : schedule.bands.find((b) => input.age! >= b.ageMin && input.age! <= b.ageMax) ?? null;
  const reason = schedule.bands.length && input.age === null ? "issue age unknown, so the base rate applied" : null;
  return { confidence, schedule, band, rateBp: band ? band.rateBp : schedule.rateBp, levelBp: schedule.levelBp, reason };
}

/** a × b / c, rounded half up, by exact integer division. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (![a, b, c].every(Number.isSafeInteger) || c <= 0) throw new Error("mulDivRound takes whole numbers");
  const sign = a < 0 !== b < 0 ? -1 : 1;
  const numerator = Math.abs(a) * Math.abs(b) * 2 + c;
  const denominator = 2 * c;
  return sign * ((numerator - (numerator % denominator)) / denominator);
}

export type AdvanceRule = { productCode: string; advanceMonths: number; advancePctBp: number; effectiveFrom: string };

export type ExpectedRow = {
  carrier_id: string;
  policy_number: string;
  policy_year: number;
  commission_trigger: Trigger;
  trigger_occurred_on: string;
  overdue_from: string | null;
  confidence: Confidence;
  reason: string | null;
  product_family: string | null;
  contract_level_bp: number | null;
  issue_age: number | null;
  schedule_id: string | null;
  schedule_version: string | null;
  band_id: string | null;
  rate_bp_applied: number | null;
  commissionable_premium_cents: number | null;
  expected_amount_cents: number | null;
  advance_months: number | null;
  advance_pct_bp: number | null;
  expected_advance_cents: number | null;
};

/**
 * One policy's expected first-year commission, or null when there is nothing to expect yet: no
 * trigger set for the carrier, or the trigger hasn't occurred. Nothing is overdue before the
 * trigger plus the carrier's lag; with no lag set, nothing is ever called overdue.
 */
export function expectedFor(input: {
  carrierId: string; policyNumber: string; trigger: Trigger | null; lagDays: number | null; triggerDay: string | null;
  family: string | null; carrierProductCode: string | null; levelBp: number | null; age: number | null; annualPremiumCents: number | null;
  schedules: Schedule[]; advanceRules: AdvanceRule[];
}): ExpectedRow | null {
  if (!input.trigger || !input.triggerDay) return null;
  const base = {
    carrier_id: input.carrierId, policy_number: input.policyNumber, policy_year: 1, commission_trigger: input.trigger, trigger_occurred_on: input.triggerDay,
    overdue_from: input.lagDays === null ? null : addDays(input.triggerDay, input.lagDays), product_family: input.family, issue_age: input.age,
  };
  const empty = { contract_level_bp: input.levelBp, schedule_id: null, schedule_version: null, band_id: null, rate_bp_applied: null, commissionable_premium_cents: input.annualPremiumCents, expected_amount_cents: null, advance_months: null, advance_pct_bp: null, expected_advance_cents: null };
  if (input.annualPremiumCents === null) return { ...base, ...empty, confidence: "no_rate_card", reason: "the carrier's file gives no premium" };
  const rate = resolveRate({ schedules: input.schedules, family: input.family, carrierProductCode: input.carrierProductCode, levelBp: input.levelBp, policyYear: 1, onDay: input.triggerDay, age: input.age });
  if (rate.confidence === "no_rate_card") return { ...base, ...empty, confidence: "no_rate_card", reason: rate.reason };
  const amount = mulDivRound(input.annualPremiumCents, rate.rateBp, 10_000);
  const advance = input.advanceRules.filter((r) => r.productCode === input.family && r.effectiveFrom <= input.triggerDay!).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  return {
    ...base,
    confidence: rate.confidence,
    reason: rate.reason,
    contract_level_bp: rate.levelBp,
    schedule_id: rate.schedule.id,
    schedule_version: rate.schedule.effectiveFrom,
    band_id: rate.band?.id ?? null,
    rate_bp_applied: rate.rateBp,
    commissionable_premium_cents: input.annualPremiumCents,
    expected_amount_cents: amount,
    advance_months: advance?.advanceMonths ?? null,
    advance_pct_bp: advance?.advancePctBp ?? null,
    expected_advance_cents: advance ? mulDivRound(amount, advance.advancePctBp, 10_000) : null,
  };
}

/** "Rate card covers 4 of 6 carriers, 71% of your monthly premium." Premium share in whole percent, rounded down. */
export function coverage(policies: Array<{ carrierId: string; monthlyCents: number; priced: boolean }>) {
  const carriers = new Map<string, boolean>();
  let totalCents = 0;
  let pricedCents = 0;
  for (const p of policies) {
    carriers.set(p.carrierId, (carriers.get(p.carrierId) ?? false) || p.priced);
    totalCents += p.monthlyCents;
    if (p.priced) pricedCents += p.monthlyCents;
  }
  const covered = [...carriers.values()].filter(Boolean).length;
  return { carriersCovered: covered, carriers: carriers.size, totalMonthlyCents: totalCents, pricedMonthlyCents: pricedCents, pricedPct: totalCents ? Math.floor((pricedCents * 100) / totalCents) : null };
}

/** "145", "82.5", "7.25" → basis points (14500, 8250, 725), from the digits, never through a float. Null if it isn't a percentage. */
export function percentToBp(text: string): number | null {
  const match = /^\s*(\d{1,4})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 14500 → "145", 8250 → "82.5", 725 → "7.25". */
export function bpToPercent(bp: number): string {
  const whole = String(Math.trunc(bp / 100));
  const rest = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}