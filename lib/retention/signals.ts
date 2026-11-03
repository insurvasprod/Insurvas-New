/**
 * LA-5.1 (Notion sprint) · the seven risk signs for one in-force policy, and the ones we could not
 * get, NAMED. This module collects; ./score.ts scores, so the score can be retuned without touching
 * collection.
 *
 * The one rule that matters most here: a missing sign stays null and is listed in `missing`. It is
 * never replaced by a median, a zero or a "typical" value, because the score has to be able to say
 * "based on 4 of 7 signals" and that sentence has to be true.
 *
 * Pure; relative imports only (the tests import it directly).
 */

import { draftTiming, recommendDraftDay, type DraftDateInput } from "../draftDates/optimiser.ts";
import type { IncomeType } from "../applications/constants.ts";
import { SIGNALS, type PaymentMethod, type RetentionSettings, type Signal } from "./constants.ts";

export type DraftInfo = {
  /** The day the carrier drafts, from the LA-3 application (carrier files do not carry it). */
  draftDay: number | null;
  /** LA-3.9's income type; "none" means the agent recorded that it is not known. */
  incomeType: IncomeType | null;
  incomeInputs: Record<string, unknown> | null;
  /** The insured's date of birth, YYYY-MM-DD: the SSA schedule's fallback when no birth day was typed. */
  dob: string | null;
  /** The agency's draft buffer (LA-3.17), 2–4. */
  buffer: number;
};

export type SignalInput = {
  status: string | null;
  paymentMethod: PaymentMethod | null;
  /** The carrier's issue date, else the effective date. */
  issueDate: string | null;
  /** The agency's day (policy_current.as_of). */
  asOf: string;
  inClawbackWindow: boolean | null;
  /** Monthly premium in cents (annualised ÷ 12), null when unknown. */
  monthlyPremiumCents: number | null;
  draft: DraftInfo | null;
  /** From policy_payment_wobble (LA-4.6's change log); null when no failure was ever seen. */
  wobble: { failures: number; lastFailureDate: string | null; recovered: boolean } | null;
  /** More than one carrier file has shown this policy: without that there is no history to read. */
  hasPaymentHistory: boolean;
  /** The carrier's files arrive about monthly: a failure that resolved inside the month is invisible. */
  monthlyCadence: boolean;
  income: { monthlyCents: number; confidence: "stated" | "estimated"; householdTotal: boolean } | null;
  /** Monthly premium of every in-force policy in the household, for a household-total income. */
  householdMonthlyPremiumCents: number | null;
  vendorId: string | null;
  campaignId: string | null;
  /** 9-month persistency of this policy's lead source and of the whole book (LA-4.18), and how many policies each rests on. */
  source: { persistencyBp: number | null; sample: number; tenantBp: number | null } | null;
  carrier: { graceDays: number | null; redraftAttempts: number | null; lapseRateBp: number | null; sample: number } | null;
};

export type SignalRow = {
  draftDay: number | null;
  expectedIncomeDay: number | null;
  incomeType: Exclude<IncomeType, "none"> | "unknown" | null;
  daysDraftBeforeIncome: number | null;
  recommendedDraftDay: number | null;
  recommendedDraftReason: string | null;
  paymentMethod: PaymentMethod | null;
  monthsSinceIssue: number | null;
  insideClawbackWindow: boolean | null;
  draftFailuresCount: number | null;
  lastFailureDate: string | null;
  recoveredAfterFailure: boolean | null;
  wobbleDetectionLimited: boolean;
  monthlyIncomeCents: number | null;
  incomeConfidence: "stated" | "estimated" | null;
  premiumPctOfIncomeBp: number | null;
  vendorId: string | null;
  campaignId: string | null;
  sourcePersistency9moBp: number | null;
  tenantPersistency9moBp: number | null;
  sourceSampleSize: number;
  carrierGraceDays: number | null;
  carrierRedraftAttempts: number | null;
  carrierLapseRateBp: number | null;
  carrierSampleSize: number;
  signalsAvailable: number;
  missing: Signal[];
};

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** Whole months from `from` to `to` (both YYYY-MM-DD); 0 inside the first month. */
export function wholeMonths(from: string, to: string): number {
  if (dayNumber(to) < dayNumber(from)) return 0;
  let months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  if (+to.slice(8, 10) < +from.slice(8, 10)) months -= 1;
  return Math.max(0, months);
}

/** The optimiser's input from what LA-3.9 stored on the application. */
export function draftInput(draft: DraftInfo, asOf: string): DraftDateInput | null {
  if (!draft.incomeType || draft.incomeType === "none") return null;
  const raw = draft.incomeInputs ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  const dobDay = draft.dob && /^\d{4}-\d{2}-\d{2}/.test(draft.dob) ? Number(draft.dob.slice(8, 10)) : null;
  return {
    incomeType: draft.incomeType,
    birthDay: num(raw.birthDay) ?? dobDay,
    before1997: raw.before1997 === true,
    pensionDay: num(raw.pensionDay),
    payFrequency: (typeof raw.payFrequency === "string" ? raw.payFrequency : null) as DraftDateInput["payFrequency"],
    payAnchor: typeof raw.payAnchor === "string" ? raw.payAnchor : null,
    buffer: draft.buffer,
    // "From" the agency's day: the optimiser drafts from the month after.
    from: new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`),
  };
}

export function deriveSignals(p: SignalInput, settings: Pick<RetentionSettings, "sampleFloor"> & Partial<Pick<RetentionSettings, "carrierSampleFloor">>): SignalRow {
  const missing = new Set<Signal>();

  // 1. Draft vs income — LA-3.9's optimiser, called, never reimplemented.
  let incomeType: SignalRow["incomeType"] = null;
  let timing: ReturnType<typeof draftTiming> = null;
  let recommended: { day: number; reason: string } | null = null;
  if (p.draft) {
    incomeType = !p.draft.incomeType || p.draft.incomeType === "none" ? "unknown" : p.draft.incomeType;
    const input = draftInput(p.draft, p.asOf);
    if (input) {
      if (p.draft.draftDay) timing = draftTiming(input, p.draft.draftDay);
      const rec = recommendDraftDay(input);
      if (rec.kind === "recommended") recommended = { day: rec.recommended.day, reason: rec.recommended.reason };
    }
  }
  if (!timing || p.paymentMethod === "direct_bill") missing.add("draft_timing");

  // 2. How they pay.
  if (!p.paymentMethod) missing.add("payment_method");

  // 3. Months since issue.
  const monthsSinceIssue = p.issueDate ? wholeMonths(p.issueDate.slice(0, 10), p.asOf) : null;
  if (monthsSinceIssue === null) missing.add("policy_age");

  // 4. Payment wobble — from the change log; one file is no history at all.
  if (!p.hasPaymentHistory) missing.add("payment_wobble");

  // 5. Affordability — only from a figure someone captured (LA-5.10).
  const premiumForIncome = p.income?.householdTotal ? p.householdMonthlyPremiumCents : p.monthlyPremiumCents;
  const pctBp = p.income && premiumForIncome !== null && premiumForIncome > 0 ? Math.round((premiumForIncome * 10_000) / p.income.monthlyCents) : null;
  if (pctBp === null) missing.add("affordability");

  // 6. Lead source — below the sample floor the figure is unavailable, not weak.
  const sourceSample = p.source?.sample ?? 0;
  const sourceBp = p.source && p.source.persistencyBp !== null && sourceSample >= settings.sampleFloor && p.source.tenantBp !== null ? p.source.persistencyBp : null;
  if (sourceBp === null) missing.add("lead_source");

  // 7. Carrier — how forgiving its grace and redrafts are (LA-4.17).
  if (p.carrier?.graceDays == null) missing.add("carrier");

  const list = SIGNALS.filter((s) => missing.has(s));
  return {
    draftDay: p.draft?.draftDay ?? null,
    expectedIncomeDay: timing?.incomeDay ?? null,
    incomeType,
    daysDraftBeforeIncome: missing.has("draft_timing") ? null : timing!.daysDraftBeforeIncome,
    recommendedDraftDay: recommended?.day ?? null,
    recommendedDraftReason: recommended?.reason ?? null,
    paymentMethod: p.paymentMethod,
    monthsSinceIssue,
    insideClawbackWindow: p.inClawbackWindow,
    draftFailuresCount: p.hasPaymentHistory ? p.wobble?.failures ?? 0 : null,
    lastFailureDate: p.hasPaymentHistory ? p.wobble?.lastFailureDate ?? null : null,
    recoveredAfterFailure: p.hasPaymentHistory && p.wobble ? p.wobble.recovered : null,
    wobbleDetectionLimited: p.monthlyCadence,
    monthlyIncomeCents: p.income?.monthlyCents ?? null,
    incomeConfidence: p.income?.confidence ?? null,
    premiumPctOfIncomeBp: pctBp,
    vendorId: p.vendorId,
    campaignId: p.campaignId,
    sourcePersistency9moBp: sourceBp,
    tenantPersistency9moBp: sourceBp === null ? null : p.source!.tenantBp,
    sourceSampleSize: sourceSample,
    carrierGraceDays: p.carrier?.graceDays ?? null,
    carrierRedraftAttempts: p.carrier?.redraftAttempts ?? null,
    carrierLapseRateBp: p.carrier && p.carrier.sample >= (settings.carrierSampleFloor ?? settings.sampleFloor) ? p.carrier.lapseRateBp : null,
    carrierSampleSize: p.carrier?.sample ?? 0,
    signalsAvailable: SIGNALS.length - list.length,
    missing: list,
  };
}
