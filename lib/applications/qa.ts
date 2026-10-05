// The pre-submission QA engine (LA-3.11). Pure and client-safe: the live QA rail runs it on every
// keystroke, the `ready` transition runs it on the server, and the submission freezes its output.
// Every item carries a deep link to the exact field, because a QA list that says something is
// missing without taking you to it is worse than none.

import { checkBeneficiaries } from "./beneficiaries.ts";
import { CANONICAL_GROUPS, OUTCOMES_NEEDING_REASON, type WorkspaceStep } from "./constants.ts";
import { cardBrand, cardExpiryInFuture } from "./formats.ts";
import { premiumPer1000, DEFAULT_PER1000_BAND } from "../quotes/math.ts";
import type { AttemptView, InterviewView } from "./types.ts";

/** `message` is the short title; `detail` says why it matters or what to do, in one sentence. */
export type QaItem = { code: string; message: string; detail: string | null; fieldKey: string | null; step: WorkspaceStep; deepLink: string };
export type QaVerdict = {
  verdict: "pass" | "pass_with_warnings" | "fail";
  blocking: QaItem[];
  warnings: QaItem[];
  /** The checks that ran and found nothing, by name — what "Passed · 14" lists. */
  passed: string[];
};

/** Every check the engine runs, by the codes it can raise. A check with none of its codes raised passed. */
const CHECKS: { label: string; codes: string[] }[] = [
  { label: "quote selected", codes: ["QA_NO_QUOTE"] },
  { label: "required fields present", codes: ["QA_REQUIRED_FIELD"] },
  { label: "primary share total", codes: ["BENEFICIARY_PRIMARY_TOTAL", "BENEFICIARY_NO_PRIMARY"] },
  { label: "contingent has a primary", codes: ["BENEFICIARY_CONTINGENT_TOTAL"] },
  { label: "beneficiary details", codes: ["BENEFICIARY_NAME", "BENEFICIARY_RELATIONSHIP", "BENEFICIARY_RELATIONSHIP_OTHER"] },
  { label: "disclosures acknowledged", codes: ["QA_DISCLOSURE"] },
  { label: "payment method complete", codes: ["QA_PAYMENT_MISSING", "QA_ROUTING", "QA_ACCOUNT", "QA_ACCOUNT_TYPE", "QA_CARD", "QA_CARD_EXPIRED"] },
  { label: "draft day", codes: ["QA_DRAFT_DAY", "QA_DRAFT_DAY_UNSAFE"] },
  { label: "issue age", codes: ["QA_ISSUE_AGE", "QA_FE_AGE"] },
  { label: "face limits", codes: ["QA_FACE_LIMIT"] },
  { label: "appointment in the client's state", codes: ["QA_APPOINTMENT"] },
  { label: "rate per $1,000", codes: ["QA_PER1000"] },
  { label: "knockout answers", codes: ["QA_KNOCKOUT"] },
  { label: "prefilled values checked", codes: ["QA_PREFILL_UNREVIEWED"] },
  { label: "payment method accepted", codes: ["QA_PAYMENT_NOT_ACCEPTED", "QA_DIRECT_EXPRESS_BIN"] },
  { label: "phone matches the address state", codes: ["QA_PHONE_STATE"] },
];

/** The one-sentence "why it matters" for each code. */
const DETAIL: Record<string, string> = {
  QA_NO_QUOTE: "The application is written against one carrier's quote. Pick it on the Quote step.",
  QA_REQUIRED_FIELD: "The carrier's form asks for this. A blank here is a kicked-back application.",
  QA_DISCLOSURE: "The carrier will not issue until it has been given. Say how it was given — read aloud, emailed or mailed.",
  QA_PAYMENT_MISSING: "Nothing can be drafted until the carrier knows how the client pays.",
  QA_ROUTING: "The carrier needs the routing number to set up the draft.",
  QA_ACCOUNT: "The carrier needs the account number to set up the draft.",
  QA_ACCOUNT_TYPE: "A savings account drafted as checking bounces.",
  QA_CARD: "The carrier needs the card number to set up the charge.",
  QA_CARD_EXPIRED: "An expired card declines on the first draft.",
  QA_DIRECT_EXPRESS_BIN: "Direct Express cards are Mastercard. A different brand usually means a mistyped number.",
  QA_DRAFT_DAY: "Carriers take a draft day from the 1st to the 28th.",
  QA_DRAFT_DAY_UNSAFE: "Drafts taken before the money arrives bounce, and bounced drafts lapse. Record why this day is right, or use the recommendation.",
  QA_PAYMENT_NOT_ACCEPTED: "This carrier product does not list the method. Check the carrier's rules before submitting.",
  QA_ISSUE_AGE: "The carrier will not issue this product at this age.",
  QA_FACE_LIMIT: "The carrier will not issue this face amount on this product.",
  QA_APPOINTMENT: "You cannot write this carrier in this state until the appointment is active.",
  QA_PHONE_STATE: "Worth a check — a mismatch is often a typo in the address.",
  QA_PER1000: "Allowed — the carrier's own tool is right. Check the tier and face you typed.",
  QA_FE_AGE: "Allowed — most final expense clients are 50 to 85.",
  QA_KNOCKOUT: "Most carriers treat this as a decline or a graded rating. Check the carrier's guide.",
  QA_PREFILL_UNREVIEWED: "It was filled in from what we already had. Confirm it with the client.",
};

export type QaSettings = {
  appointmentBlocks: boolean;
  per1000Band: { min: number; max: number };
};

export const DEFAULT_QA_SETTINGS: QaSettings = { appointmentBlocks: false, per1000Band: DEFAULT_PER1000_BAND };

const FIELD_STEP: Record<string, WorkspaceStep> = { insured: "application", contact: "application", addr: "application", owner: "application", cov: "quote", pay: "payment" };
const LABEL = new Map(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label] as const)));

function ageFrom(dob: unknown, today: Date) {
  if (typeof dob !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  let age = today.getUTCFullYear() - Number(m[1]);
  const month = today.getUTCMonth() + 1;
  if (month < Number(m[2]) || (month === Number(m[2]) && today.getUTCDate() < Number(m[3]))) age--;
  return age;
}

export function runQa(input: {
  caseId: string;
  attempt: AttemptView;
  interview?: InterviewView | null;
  settings?: QaSettings;
  /** Area-code state of the client's phone, when known (warning only). */
  phoneState?: string | null;
  today?: Date;
}): QaVerdict {
  const { attempt, caseId } = input;
  const settings = input.settings ?? DEFAULT_QA_SETTINGS;
  const today = input.today ?? new Date();
  const blocking: QaItem[] = [];
  const warnings: QaItem[] = [];
  const link = (step: WorkspaceStep, fieldKey: string | null) =>
    `/app/applications/${caseId}?attempt=${attempt.attemptNo}&insured=${attempt.insuredRole}&step=${step}${fieldKey ? `#${fieldKey}` : ""}`;
  const add = (list: QaItem[], code: string, message: string, fieldKey: string | null, step?: WorkspaceStep) => {
    const s = step ?? (fieldKey ? FIELD_STEP[fieldKey.split(".")[0]] ?? "application" : "application");
    list.push({ code, message, detail: DETAIL[code] ?? null, fieldKey, step: s, deepLink: link(s, fieldKey) });
  };
  const v = (key: string) => attempt.values[key];
  const has = (key: string) => {
    const f = v(key);
    return Boolean(f && (f.hasValue || (f.value !== null && f.value !== "")));
  };

  // ── blocking ────────────────────────────────────────────────────────────
  if (!attempt.carrierId || !attempt.selectedQuoteId) add(blocking, "QA_NO_QUOTE", "Select a quote before submitting.", null, "quote");
  for (const key of attempt.requiredKeys) {
    if (key.startsWith("pay.")) continue; // payment is checked by method below
    if (!has(key)) add(blocking, "QA_REQUIRED_FIELD", `${LABEL.get(key) ?? key} is required by ${attempt.carrierName ?? "this carrier"}.`, key);
  }

  for (const issue of checkBeneficiaries(attempt.beneficiaries, today)) {
    add(issue.severity === "block" ? blocking : warnings, issue.code, issue.message, issue.id ? `beneficiary.${issue.id}` : null, "beneficiaries");
  }

  for (const d of attempt.disclosures) {
    if (d.status === "required") add(blocking, "QA_DISCLOSURE", `${d.title} has not been acknowledged.`, `disclosure.${d.code}`, "disclosures");
  }

  const pay = attempt.payment;
  if (!pay) add(blocking, "QA_PAYMENT_MISSING", "Choose how the client will pay.", "pay.method", "payment");
  else {
    if (pay.method === "ach") {
      if (!pay.routing?.hasValue) add(blocking, "QA_ROUTING", "Routing number is missing.", "pay.routing_number", "payment");
      if (!pay.account?.hasValue) add(blocking, "QA_ACCOUNT", "Account number is missing.", "pay.account_number", "payment");
      if (!pay.accountType) add(blocking, "QA_ACCOUNT_TYPE", "Say whether it is checking or savings.", "pay.account_type", "payment");
    }
    if (pay.method === "direct_express" || pay.method === "debit_card" || pay.method === "credit_card") {
      if (!pay.card?.hasValue) add(blocking, "QA_CARD", "Card number is missing.", "pay.card_number", "payment");
      else if (pay.card.expMonth && pay.card.expYear && !cardExpiryInFuture(pay.card.expMonth, pay.card.expYear, today)) add(blocking, "QA_CARD_EXPIRED", "The card has expired.", "pay.card_exp", "payment");
      if (pay.method === "direct_express" && pay.card?.brand && pay.card.brand !== "mastercard") add(warnings, "QA_DIRECT_EXPRESS_BIN", "Direct Express cards are Mastercard — check the number.", "pay.card_number", "payment");
    }
    if (pay.method !== "direct_bill") {
      if (!pay.draftDay || pay.draftDay < 1 || pay.draftDay > 28) add(blocking, "QA_DRAFT_DAY", "Pick a draft day between the 1st and the 28th.", "pay.draft_day", "payment");
      else if (pay.draftDayRecommended && pay.draftDay !== pay.draftDayRecommended && !pay.draftOverrideReason) add(warnings, "QA_DRAFT_DAY_UNSAFE", `The ${pay.draftDay} is not the safe draft day (${pay.draftDayRecommended}). Record why, or use the recommendation.`, "pay.draft_day", "payment");
    }
    if (attempt.product?.acceptedPaymentMethods.length && !attempt.product.acceptedPaymentMethods.includes(pay.method)) {
      add(warnings, "QA_PAYMENT_NOT_ACCEPTED", `${attempt.carrierName ?? "This carrier"} does not list this payment method.`, "pay.method", "payment");
    }
  }

  const dob = v("insured.dob")?.value;
  const age = ageFrom(dob, today);
  const p = attempt.product;
  if (age !== null && p?.issueAgeMin != null && age < p.issueAgeMin) add(blocking, "QA_ISSUE_AGE", `Age ${age} is under the issue age (${p.issueAgeMin}).`, "insured.dob");
  if (age !== null && p?.issueAgeMax != null && age > p.issueAgeMax) add(blocking, "QA_ISSUE_AGE", `Age ${age} is over the issue age (${p.issueAgeMax}).`, "insured.dob");

  const selected = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  if (selected && p?.faceMinCents != null && selected.faceAmountCents < p.faceMinCents) add(blocking, "QA_FACE_LIMIT", "The face amount is under this product's minimum.", "cov.face_amount", "quote");
  if (selected && p?.faceMaxCents != null && selected.faceAmountCents > p.faceMaxCents) add(blocking, "QA_FACE_LIMIT", "The face amount is over this product's maximum.", "cov.face_amount", "quote");

  if (!attempt.appointment.ok) add(settings.appointmentBlocks ? blocking : warnings, "QA_APPOINTMENT", attempt.appointment.reason ?? "No active appointment covers the client's state.", null, "quote");

  // ── warnings ────────────────────────────────────────────────────────────
  const state = v("addr.state")?.value;
  if (input.phoneState && typeof state === "string" && state && input.phoneState !== state) add(warnings, "QA_PHONE_STATE", `The address is in ${state} but the phone number is a ${input.phoneState} number.`, "addr.state");
  // The product's own band first (LA-3.25 · bands resolve per product), else the agency's. The agency's
  // is a Final Expense range; term rates a fraction of it and is only judged by a band its product sets.
  const band = p?.band ?? (attempt.productCode !== "term_life" ? settings.per1000Band : null);
  if (selected && band) {
    const per = premiumPer1000(selected.monthlyPremiumCents, selected.faceAmountCents);
    if (per !== null && (per < band.min || per > band.max)) add(warnings, "QA_PER1000", `$${per.toFixed(2)} per $1,000 is outside the usual range — check the tier.`, "cov.monthly_premium", "quote");
  }
  if (age !== null && attempt.productCode === "final_expense" && (age < 40 || age > 85)) add(warnings, "QA_FE_AGE", `Age ${age} is unusual for final expense.`, "insured.dob");

  const interview = input.interview;
  if (interview) {
    for (const q of interview.questions) {
      if (!q.knockout) continue;
      const a = interview.answers[q.key]?.value;
      if (a !== undefined && a !== null && String(a) === String(q.knockout.when)) add(warnings, "QA_KNOCKOUT", `Knockout: ${q.label} — ${q.knockout.note}`, `health.${q.key}`, "interview");
    }
  }

  for (const [key, f] of Object.entries(attempt.values)) {
    if (f.source !== "manual" && f.source !== "household" && !f.reviewed && attempt.requiredKeys.includes(key)) {
      add(warnings, "QA_PREFILL_UNREVIEWED", `${LABEL.get(key) ?? key} was filled in for you and has not been checked.`, key);
    }
  }

  const raised = new Set([...blocking, ...warnings].map((i) => i.code));
  const passed = CHECKS.filter((c) => !c.codes.some((code) => raised.has(code))).map((c) => c.label);
  return { verdict: blocking.length ? "fail" : warnings.length ? "pass_with_warnings" : "pass", blocking, warnings, passed };
}

export { cardBrand, OUTCOMES_NEEDING_REASON };
