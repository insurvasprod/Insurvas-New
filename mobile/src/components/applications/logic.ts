import type { Answers, AnswerValue, ApplicationRow, AttemptView, CaseView, DraftRecommendation, IncomeType, InterviewQuestion, InterviewView, QuoteView } from "./types";

/**
 * The rules the application screens draw from, pure so they are tested on their own. Each mirrors the
 * web workspace (components/app/applications/workspace/*) so the phone and the computer agree on what
 * a step needs; the server still decides every save.
 */

// ─── the ten steps (board E2b) ─────────────────────────────────────────────────────────────────
/**
 * The board's ten, in its order. They are the web workspace's steps (lib/applications/constants.ts
 * WORKSPACE_STEPS) cut the way a phone asks them: the web's one Interview is three steps here (the
 * persistency questions, the health questions, the medicines), its Disclosures are read at Review, and
 * After submit is the case screen (E6). `web` is the web step a hand-off to the computer opens.
 */
export const STEPS = [
  { key: "verify", label: "Verify", web: "verify" },
  { key: "quote", label: "Quote", web: "quote" },
  { key: "eligibility", label: "Eligibility", web: "interview" },
  { key: "personal", label: "Personal details", web: "application" },
  { key: "health", label: "Health", web: "interview" },
  { key: "medications", label: "Medications", web: "interview" },
  { key: "beneficiaries", label: "Beneficiary", web: "beneficiaries" },
  { key: "payment", label: "Payment", web: "payment" },
  { key: "review", label: "Review", web: "review" },
  { key: "submit", label: "Sign", web: "submit" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
export const isStepKey = (v: unknown): v is StepKey => STEPS.some((s) => s.key === v);
export const webStep = (k: StepKey) => STEPS.find((s) => s.key === k)?.web ?? k;
export const stepLabel = (k: StepKey) => STEPS.find((s) => s.key === k)?.label ?? k;

/** The three interview steps. */
export type InterviewPart = "eligibility" | "health" | "medications";
export const isInterviewPart = (k: StepKey): k is InterviewPart => k === "eligibility" || k === "health" || k === "medications";

/** Decision 6 (settled): the phone takes the full application for the products with the deep flow. */
export const PHONE_PRODUCTS = new Set(["final_expense", "whole_life", "term_life"]);

export const submittedStatus = (s: AttemptView["status"]) => s !== "draft" && s !== "ready";

/** The attempt on screen: the primary insured's newest one that is still open, else its newest. */
export function pickAttempt(c: CaseView): AttemptView | null {
  const mine = c.attempts.filter((a) => a.insuredRole === "primary").sort((a, b) => a.attemptNo - b.attemptNo);
  const list = mine.length ? mine : c.attempts;
  return list.find((a) => a.status !== "closed") ?? list[list.length - 1] ?? null;
}

function hasValue(v: AttemptView["values"][string] | undefined): boolean {
  if (!v) return false;
  if (v.hasValue !== undefined) return v.hasValue;
  return v.value !== null && v.value !== "";
}

/**
 * Whether a step is finished, as the web's rail ticks it (application-workspace.tsx stepDone). The
 * web also holds a step back while the QA rail blocks it; the phone has no QA rail, so a step can
 * read done here and still be refused when the application is marked ready — the server says why.
 */
export function stepDone(key: StepKey, c: CaseView, a: AttemptView, interview: InterviewView | null): boolean {
  const submitted = submittedStatus(a.status);
  switch (key) {
    case "verify": return submitted || Boolean(c.verification?.complete);
    case "quote": return Boolean(a.selectedQuoteId);
    case "eligibility": case "health": return submitted || partDone(interview, key);
    case "medications": return submitted || Boolean(interview?.completedAt);
    case "personal": return Boolean(a.selectedQuoteId) && a.requiredKeys.every((k) => hasValue(a.values[k]));
    case "beneficiaries": return a.beneficiaries.length > 0;
    case "payment": return Boolean(a.payment);
    case "review": return a.status !== "draft";
    case "submit": return submitted;
  }
}

export type StepState = { key: StepKey; label: string; number: number; done: boolean; state: "done" | "now" | "open" | "locked" };

/**
 * Board E2b: done, now, and locked. As on the web's rail, a step opens once every step before it is
 * finished (or it is the one on screen); a step already done is never locked.
 */
export function stepStates(c: CaseView, a: AttemptView, interview: InterviewView | null, current: StepKey): StepState[] {
  const done = STEPS.map((s) => stepDone(s.key, c, a, interview));
  const firstOpen = done.indexOf(false);
  const reach = firstOpen === -1 ? STEPS.length - 1 : firstOpen;
  const here = STEPS.findIndex((s) => s.key === current);
  return STEPS.map((s, i) => {
    const locked = !(i <= Math.max(reach, here) || done[i]);
    const state = i === here ? "now" : done[i] ? "done" : locked ? "locked" : "open";
    return { key: s.key, label: s.label, number: i + 1, done: done[i], state };
  });
}

/**
 * Where a case resumes: the first step not finished ("Resuming lands exactly where the call dropped").
 * A submitted or closed attempt opens on Sign, which then says where it went.
 */
export function resumeStep(c: CaseView, a: AttemptView, interview: InterviewView | null): StepKey {
  if (submittedStatus(a.status)) return "submit";
  const open = STEPS.find((s) => !stepDone(s.key, c, a, interview));
  return open?.key ?? "submit";
}

/** The steps the phone hands to the computer (decision 6: tables and many fields). */
export const COMPUTER_STEPS: readonly StepKey[] = ["verify", "personal", "beneficiaries"];
export const isComputerStep = (k: StepKey) => COMPUTER_STEPS.includes(k);

/**
 * What still stands between the application and Mark ready: every step before Review not finished, in
 * order. Review and Sign hold Mark ready back until it is empty (the server's QA check would refuse it
 * anyway); the agent saves the draft and finishes the rest, often on a computer.
 */
export function stepsLeft(c: CaseView, a: AttemptView, interview: InterviewView | null): StepKey[] {
  if (a.status !== "draft") return [];
  const review = STEPS.findIndex((s) => s.key === "review");
  return STEPS.slice(0, review).filter((s) => !stepDone(s.key, c, a, interview)).map((s) => s.key);
}

/** The web page a saved draft continues on: the first step left that needs the computer, else Review. */
export function continuePath(caseId: string, left: readonly StepKey[]): string {
  const k = left.find(isComputerStep) ?? left[0] ?? "review";
  return `/app/applications/${caseId}?step=${webStep(k)}`;
}

/**
 * A `?step=` from an older link or the web's own step names (interview, application, disclosures,
 * after): the phone step that holds it. Unknown values resume where the case stopped.
 */
export function phoneStep(step: unknown, c: CaseView, a: AttemptView, interview: InterviewView | null): StepKey {
  if (isStepKey(step)) return step;
  if (step === "interview") return (["eligibility", "health", "medications"] as const).find((k) => !stepDone(k, c, a, interview)) ?? "medications";
  if (step === "application") return "personal";
  if (step === "disclosures") return "review";
  if (step === "after") return "submit";
  return resumeStep(c, a, interview);
}

/** "Step 5 of 10 · Health": a draft's place, for the Applications list (board E0). */
export function stepLine(c: CaseView, a: AttemptView, interview: InterviewView | null): string {
  const k = resumeStep(c, a, interview);
  const i = STEPS.findIndex((s) => s.key === k);
  return `step ${i + 1} of ${STEPS.length} · ${STEPS[i].label}`;
}

// ─── the interview, one question per screen (interview-form.tsx) ─────────────────────────────
/**
 * A typed number no person can be: a height outside 3–8 feet, a weight outside 50–700 lb, or a count or
 * amount below zero. Said before it is saved, so a slip ("6464" for 64) never reaches the carrier.
 */
export function numberRangeError(key: string, n: number): string | null {
  if (/height/i.test(key) && (n < 36 || n > 96)) return "Type the height in inches, between 36 and 96 (5 ft 4 in is 64).";
  if (/weight/i.test(key) && (n < 50 || n > 700)) return "Type the weight in pounds, between 50 and 700.";
  if (n < 0) return "Type a number of zero or more.";
  return null;
}

export function isVisible(q: InterviewQuestion, byKey: Map<string, InterviewQuestion>, answers: Answers, depth = 0): boolean {
  if (!q.showWhen) return true;
  const parent = byKey.get(q.showWhen.key);
  if (parent && depth < 8 && !isVisible(parent, byKey, answers, depth + 1)) return false;
  const v = answers[q.showWhen.key]?.value;
  return v !== null && v !== undefined && String(v) === String(q.showWhen.equals);
}

/** A follow-up that is no longer shown takes its answer with it; the keys removed are sent as `hidden`. */
export function pruneHidden(questions: InterviewQuestion[], answers: Answers): { answers: Answers; hidden: string[] } {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const next = { ...answers };
  const hidden: string[] = [];
  for (const q of questions) if (q.key in next && !isVisible(q, byKey, next)) { delete next[q.key]; hidden.push(q.key); }
  return { answers: next, hidden };
}

/** The medication answer when the client takes none (question-input.tsx NO_MEDICATIONS). */
export const NO_MEDICATIONS = "none";

export function isAnswered(q: InterviewQuestion, value: AnswerValue | undefined, medicationCount = 0): boolean {
  if (q.type === "medication_list") return medicationCount > 0 || value === NO_MEDICATIONS;
  if (value === null || value === undefined || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

export function isKnockedOut(q: InterviewQuestion, value: AnswerValue | undefined): boolean {
  return Boolean(q.knockout && value !== null && value !== undefined && String(value) === String(q.knockout.when));
}

/**
 * The questions in the order they are asked: the five persistency questions first, then template
 * order, each follow-up straight after the answer that opened it; the medication list last. Only the
 * questions the answers so far show.
 */
export function questionFlow(questions: InterviewQuestion[], answers: Answers): InterviewQuestion[] {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const flow = questions.filter((q) => q.type !== "medication_list");
  const inFlow = new Set(flow.map((q) => q.key));
  const childrenOf = new Map<string, InterviewQuestion[]>();
  const roots: InterviewQuestion[] = [];
  for (const q of flow) {
    const parent = q.showWhen?.key;
    if (parent && inFlow.has(parent) && parent !== q.key) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), q]);
    else roots.push(q);
  }
  roots.sort((a, b) => Number(Boolean(b.persistency)) - Number(Boolean(a.persistency)));
  const out: InterviewQuestion[] = [];
  const walk = (q: InterviewQuestion) => {
    if (!isVisible(q, byKey, answers)) return;
    out.push(q);
    for (const k of childrenOf.get(q.key) ?? []) walk(k);
  };
  roots.forEach(walk);
  const meds = questions.find((q) => q.type === "medication_list");
  if (meds && isVisible(meds, byKey, answers)) out.push(meds);
  return out;
}

/**
 * Which of the three interview steps a question is asked in: the medicines in Medications, the
 * persistency questions (and every follow-up they open) in Eligibility, the rest in Health.
 */
export function partOf(q: InterviewQuestion, byKey: Map<string, InterviewQuestion>): InterviewPart {
  let root = q;
  for (let depth = 0; root.showWhen && depth < 8; depth++) {
    const parent = byKey.get(root.showWhen.key);
    if (!parent || parent.key === root.key) break;
    root = parent;
  }
  if (q.type === "medication_list" || root.type === "medication_list") return "medications";
  return root.persistency ? "eligibility" : "health";
}

/** One interview step's questions, in the order they are asked, as the answers so far show them. */
export function partFlow(questions: InterviewQuestion[], answers: Answers, part: InterviewPart): InterviewQuestion[] {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  return questionFlow(questions, answers).filter((q) => partOf(q, byKey) === part);
}

/**
 * Eligibility and Health are done once every required question they show is answered (or the whole
 * interview is complete); Medications only when the interview is marked complete, which it finishes.
 */
export function partDone(interview: InterviewView | null, part: InterviewPart): boolean {
  if (!interview) return false;
  if (interview.completedAt) return true;
  if (part === "medications") return false;
  return partFlow(interview.questions, interview.answers, part)
    .every((q) => !q.required || isAnswered(q, interview.answers[q.key]?.value, interview.medications.length));
}

/** The section a question sits under, as the web heads it. */
export const sectionOf = (q: InterviewQuestion) => (q.persistency ? "Before we start" : q.section || "Questions");

/** "Health · 3 of 7": the question's place in its own section. */
export function sectionPosition(flow: InterviewQuestion[], index: number): { section: string; at: number; of: number } {
  const q = flow[index];
  if (!q) return { section: "", at: 0, of: 0 };
  const section = sectionOf(q);
  const same = flow.filter((x) => sectionOf(x) === section);
  return { section, at: same.indexOf(q) + 1, of: same.length };
}

/** Where a dropped call resumes: the first question still unanswered, else the last one. */
export function resumeQuestion(flow: InterviewQuestion[], answers: Answers, medicationCount: number): number {
  const i = flow.findIndex((q) => !isAnswered(q, answers[q.key]?.value, medicationCount));
  return i === -1 ? Math.max(0, flow.length - 1) : i;
}

// ─── the Applications list (board E0) ────────────────────────────────────────────────────────
export type ListFilter = "progress" | "ready" | "submitted";
export const LIST_FILTERS: { key: ListFilter; label: string }[] = [
  { key: "progress", label: "In progress" },
  // An attempt marked ready has passed review and waits on the client's signature and the submit.
  { key: "ready", label: "Needs signature" },
  { key: "submitted", label: "Submitted" },
];

/** Which chip a row is under; closed attempts are history and sit on the web's list only. */
export function rowFilter(status: ApplicationRow["status"]): ListFilter | null {
  if (status === "draft") return "progress";
  if (status === "ready") return "ready";
  if (status === "closed") return null;
  return "submitted";
}

export function listCounts(rows: ApplicationRow[]): Record<ListFilter, number> {
  const out: Record<ListFilter, number> = { progress: 0, ready: 0, submitted: 0 };
  for (const r of rows) { const f = rowFilter(r.status); if (f) out[f] += 1; }
  return out;
}

const STATUS_WORDS: Record<ApplicationRow["status"], string> = {
  draft: "Draft", ready: "Needs signature", submitted: "Submitted", pending_carrier: "Pending carrier", counteroffer_pending: "Counteroffer", closed: "Closed",
};
export const statusWords = (s: ApplicationRow["status"]) => STATUS_WORDS[s];

// ─── money and numbers ───────────────────────────────────────────────────────────────────────
/** A premium to the cent, as the carrier quoted it ($52.18); the web's application screens print it so too. */
export function premium(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A face amount in whole dollars ($15,000). */
export function face(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** "$15,000" or "52.18" typed → cents; null when it is not a positive amount. */
export function toCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : null;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** The quotes still on offer, cheapest first (board E1: "cheapest first"); discarded ones are the record. */
export function rankQuotes(quotes: QuoteView[]): QuoteView[] {
  return quotes.filter((q) => q.status !== "discarded").sort((a, b) => a.monthlyPremiumCents - b.monthlyPremiumCents);
}

const TIER_WORDS: Record<string, string> = { level: "Level", graded: "Graded", modified: "Modified", gi: "Guaranteed" };
export const tierLabel = (t: string | null | undefined) => (t ? TIER_WORDS[t] ?? t[0].toUpperCase() + t.slice(1) : "");
/** The final expense tiers (lib/applications/constants.ts FE_TIERS) when a product names none. */
export const DEFAULT_TIERS = ["level", "graded", "gi"];

// ─── the insured ─────────────────────────────────────────────────────────────────────────────
function text(a: AttemptView, key: string): string {
  const v = a.values[key]?.value;
  return typeof v === "string" ? v.trim() : "";
}

export function insuredName(a: AttemptView, fallback: string): string {
  return [text(a, "insured.first_name"), text(a, "insured.last_name")].filter(Boolean).join(" ") || fallback;
}

/** The day of the month the insured was born, for the Social Security schedule (draft-date-panel dobDay). */
export function dobDay(a: AttemptView): number | null {
  const m = /^\d{4}-\d{2}-(\d{2})/.exec(text(a, "insured.dob"));
  return m ? Number(m[1]) : null;
}

/** The beneficiary line for the summary: "Grace Okafor · 100%", or how many there are. */
export function beneficiaryLine(a: AttemptView): string | null {
  const primary = a.beneficiaries.filter((b) => b.tier === "primary");
  if (!primary.length) return null;
  if (primary.length > 1) return `${primary.length} people`;
  const b = primary[0];
  return `${[b.first_name, b.last_name].filter(Boolean).join(" ")} · ${Math.round(b.share_bp / 100)}%`;
}

// ─── the draft day ───────────────────────────────────────────────────────────────────────────
export const INCOME_LABEL: Record<IncomeType, string> = {
  ssa: "Social Security", ssi: "SSI", ssa_ssi: "Social Security and SSI", pension: "Pension", payroll: "Paycheck", va: "VA benefits", none: "Not sure",
};

/** The optimiser's inputs from what the payment already holds, filling the birth day from the date of birth. */
export function draftInputs(incomeType: IncomeType, stored: Record<string, unknown>, birthDay: number | null): Record<string, unknown> {
  const pick = (k: string) => (stored[k] === undefined || stored[k] === null ? undefined : stored[k]);
  const out: Record<string, unknown> = {};
  if (incomeType === "ssa") { out.birthDay = pick("birthDay") ?? birthDay ?? undefined; out.before1997 = pick("before1997") ?? false; }
  if (incomeType === "pension") out.pensionDay = pick("pensionDay");
  if (incomeType === "payroll") { out.payFrequency = pick("payFrequency"); out.payAnchor = pick("payAnchor"); }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/** "2 days after the deposit · always clears": the gap the optimiser measured, in words. */
export function gapLine(minGapDays: number): string {
  if (!Number.isFinite(minGapDays) || minGapDays <= 0) return "Income timing unknown";
  return `${minGapDays} day${minGapDays === 1 ? "" : "s"} after the deposit, every month`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Today on this phone, "YYYY-MM-DD". */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** The first date after `today` that falls on `day` of the month: when a draft on that day first comes out. */
export function nextDraftDate(day: number, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (day > d) return `${y}-${pad2(m)}-${pad2(day)}`;
  return m === 12 ? `${y + 1}-01-${pad2(day)}` : `${y}-${pad2(m + 1)}-${pad2(day)}`;
}

/** "Fri 18 Dec" for a date key. */
export function dateWords(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(d);
  return `${f({ weekday: "short" })} ${d.getUTCDate()} ${f({ month: "short" })}`;
}

export type DraftChoice = { day: number; date: string; meta: string; best: boolean; risky: boolean };

/**
 * Board E3 · the optimiser's days as the dates they first come out: each measured against the deposit
 * before it (the optimiser's own `arrivals`), the recommended one first ("usually clears"), then the
 * alternates, then the next deposit day itself, offered and marked Risky. Nothing here is guessed:
 * with no deposit dates the gap the optimiser measured is said instead.
 */
export function draftChoices(rec: DraftRecommendation | null, today: string): DraftChoice[] {
  if (!rec || rec.kind === "not_applicable") return [];
  const arrivals = (rec.arrivals ?? []).map((a) => a.date).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  const before = (date: string) => arrivals.filter((x) => x <= date).pop() ?? null;
  const out: DraftChoice[] = [rec.recommended, ...rec.alternates].map((o, i) => {
    const date = nextDraftDate(o.day, today);
    const deposit = before(date);
    const gap = deposit ? daysBetween(deposit, date) : null;
    const best = i === 0 && rec.kind === "recommended";
    const meta = gap === null ? gapLine(o.minGapDays)
      : `${gap === 0 ? "Deposit day" : `${gap} day${gap === 1 ? "" : "s"} after the deposit`}${best ? " · usually clears" : ""}`;
    return { day: o.day, date, meta, best, risky: false };
  });
  const deposit = arrivals.find((x) => x > today);
  const depositDay = deposit ? Number(deposit.slice(8, 10)) : 0;
  if (deposit && depositDay <= 28 && !out.some((o) => o.day === depositDay)) {
    out.push({ day: depositDay, date: deposit, meta: "Deposit day · can bounce if it lands late", best: false, risky: true });
  }
  return out;
}

/** "Pick another date": the date each draft day (the 1st to the 28th, as carriers allow) next comes round, soonest first. */
export function pickableDates(today: string): string[] {
  return Array.from({ length: 28 }, (_, i) => nextDraftDate(i + 1, today)).sort();
}
