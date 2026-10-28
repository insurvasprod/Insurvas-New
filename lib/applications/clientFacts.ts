// Application › Interview · the client card (owner pick C, 2026-10-28): the answers given so far, turned into
// plain words about this client — what they mean for the case and what to do about it. Pure and client-safe.
//
// It reads only what the template asked: the five persistency questions by their fixed keys, any knockout
// answered, the medication rows, and the lifestyle / coverage questions the application reads. It decides
// nothing about acceptance (Module 3 declines a carrier acceptance table): a knockout repeats the agency's own
// note, nothing more.

import type { InterviewQuestion, InterviewView, MedicationRow } from "./types.ts";

export type FactTone = "good" | "warning" | "danger" | "neutral";
export type ClientFact = { key: string; tone: FactTone; title: string; detail: string; questionKey: string | null };

type Answers = InterviewView["answers"];
const value = (answers: Answers, key: string) => answers[key]?.value;
const isYes = (v: unknown) => v === true || v === "true" || (typeof v === "string" && /^yes$/i.test(v));
const isNo = (v: unknown) => v === false || v === "false" || (typeof v === "string" && /^no$/i.test(v));
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toLocaleString("en-US")}` : null);

export function clientFacts(questions: InterviewQuestion[], answers: Answers, medications: MedicationRow[]): ClientFact[] {
  const facts: ClientFact[] = [];
  const asks = (key: string) => questions.some((q) => q.key === key);

  const deposit = value(answers, "ss_deposit_day");
  if (typeof deposit === "string" && deposit) {
    facts.push(/not on/i.test(deposit)
      ? { key: "deposit", tone: "neutral", title: "Not on Social Security", detail: "Ask which day their money lands, and draft after it.", questionKey: "ss_deposit_day" }
      : { key: "deposit", tone: "good", title: `Paid on the ${deposit}`, detail: "Set the draft date after it on Payment: drafting before the deposit is the top cause of month-4 lapse.", questionKey: "ss_deposit_day" });
  }
  if (isNo(value(answers, "deposit_account"))) facts.push({ key: "account", tone: "warning", title: "Drafts from a different account", detail: "Confirm which account on Payment: a draft on the wrong one fails on day one.", questionKey: "deposit_account" });
  if (isYes(value(answers, "decision_maker"))) facts.push({ key: "decider", tone: "warning", title: "Someone else decides with them", detail: "Get them on the call before you quote.", questionKey: "decision_maker" });
  if (isYes(value(answers, "existing_coverage"))) facts.push({ key: "replacement", tone: "warning", title: "Has a policy now", detail: "A replacement notice comes up on Disclosures.", questionKey: "existing_coverage" });
  if (isNo(value(answers, "can_receive_text"))) facts.push({ key: "text", tone: "warning", title: "Can't get a text or email on the call", detail: "Plan how they will sign before you submit.", questionKey: "can_receive_text" });

  for (const q of questions) {
    const v = value(answers, q.key);
    if (q.knockout && v !== null && v !== undefined && String(v) === String(q.knockout.when)) {
      facts.push({ key: `ko-${q.key}`, tone: "danger", title: q.label.replace(/\?$/, ""), detail: q.knockout.note?.trim() || "This answer rules some carriers out.", questionKey: q.key });
    }
  }

  if (asks("medications") || questions.some((q) => q.type === "medication_list")) {
    const unknown = medications.filter((m) => m.prescribedForUnknown || !m.prescribedFor.trim()).map((m) => m.name).filter(Boolean);
    if (medications.length) {
      facts.push({ key: "meds", tone: unknown.length ? "warning" : "neutral", title: `${medications.length} medication${medications.length === 1 ? "" : "s"}`,
        detail: unknown.length ? `Ask what ${unknown.join(" and ")} ${unknown.length === 1 ? "is" : "are"} for.` : medications.map((m) => m.name).filter(Boolean).join(", "), questionKey: questions.find((q) => q.type === "medication_list")?.key ?? null });
    }
  }

  const tobacco = value(answers, "tobacco");
  if (isYes(tobacco) || isNo(tobacco)) facts.push({ key: "tobacco", tone: "neutral", title: isYes(tobacco) ? "Tobacco rates" : "Non-tobacco rates", detail: "From the last 12 months. It fills the application.", questionKey: "tobacco" });
  const height = value(answers, "height_in");
  const weight = value(answers, "weight_lb");
  if (typeof height === "number" && typeof weight === "number" && height > 0) {
    facts.push({ key: "build", tone: "neutral", title: `${Math.floor(height / 12)}′${height % 12}″, ${weight} lb`, detail: "Fills the application.", questionKey: "height_in" });
  }
  const wanted = money(value(answers, "coverage_wanted"));
  const budget = money(value(answers, "monthly_budget"));
  if (wanted || budget) facts.push({ key: "coverage", tone: "neutral", title: wanted ? `Wants ${wanted} of coverage` : `Budget ${budget} a month`, detail: wanted && budget ? `Can pay about ${budget} a month.` : "Use it on the Quote step.", questionKey: wanted ? "coverage_wanted" : "monthly_budget" });
  return facts;
}
