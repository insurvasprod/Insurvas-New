// Sales templates (LA-3.1 underwriting, 3.4 quotation, 3.7 field sets) → the view models the
// screens render. Pure and client-safe. The stored definition is LA-1.4's own shape —
// {fields, form_definition} — so this reads it the way lib/templates does, never a second format.

import type { InterviewQuestion } from "./types.ts";

type StoredField = {
  field_key: string;
  label: string;
  type: string;
  is_required?: boolean;
  options?: unknown[];
  sort_order?: number;
  help_text?: string | null;
  persistency?: boolean;
};
type StoredFormField = {
  field_key: string;
  is_required?: boolean;
  show_when?: { field_key: string; equals: unknown } | null;
  is_knockout?: boolean;
  knockout_when?: { equals: unknown } | null;
  knockout_note?: string | null;
  applies_to?: "all" | "age_50_plus" | "age_under_50" | "tobacco";
};
export type StoredDefinition = {
  fields?: StoredField[];
  form_definition?: { sections?: { section_key: string; label: string; sort_order?: number; fields?: StoredFormField[] }[] };
  age_basis?: "nearest" | "last";
  required?: string[];
  optional?: string[];
};

const TYPES = new Set(["boolean", "single_select", "multi_select", "number", "date", "text", "long_text", "medication_list"]);

/** LA-1.4 stores "true"/"false" for boolean conditions; answers hold real booleans. */
function normalise(v: unknown): string | boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return String(v);
}

function optionText(o: unknown) {
  if (typeof o === "string") return o;
  if (o && typeof o === "object" && "label" in o) return String((o as { label: unknown }).label);
  if (o && typeof o === "object" && "value" in o) return String((o as { value: unknown }).value);
  return String(o);
}

export type TemplateChoice = { id: string; version: number; tenant_id: string | null; carrier_id: string | null; product_code: string };

/**
 * Which published template a new interview (or field set) uses (LA-3.1): the attempt carrier's own
 * for the case's product (the agency's, then the platform's), then the product's general one (the
 * agency's, then the platform's), then the Final Expense general one as the last resort. The newest
 * version wins inside each rung. An interview already started keeps the template it started on.
 */
export function pickTemplate<T extends TemplateChoice>(list: readonly T[], opts: { tenantId: string; carrierId: string | null; productCode: string | null }): T | null {
  const newest = (xs: T[]) => [...xs].sort((a, b) => b.version - a.version)[0] ?? null;
  const rung = (carrierId: string | null, productCode: string | null, mine: boolean) =>
    productCode === null ? null : newest(list.filter((t) => t.carrier_id === carrierId && t.product_code === productCode && (mine ? t.tenant_id === opts.tenantId : t.tenant_id === null)));
  const ladder: [string | null, string | null, boolean][] = [
    ...(opts.carrierId ? [[opts.carrierId, opts.productCode, true], [opts.carrierId, opts.productCode, false]] as [string, string | null, boolean][] : []),
    [null, opts.productCode, true], [null, opts.productCode, false],
    [null, "final_expense", true], [null, "final_expense", false],
  ];
  for (const [carrierId, productCode, mine] of ladder) {
    const hit = rung(carrierId, productCode, mine);
    if (hit) return hit;
  }
  return null;
}

/** The interview's questions, in section then sort order, exactly as the template lays them out. */
export function interviewQuestions(def: StoredDefinition | null | undefined): InterviewQuestion[] {
  if (!def) return [];
  const byKey = new Map((def.fields ?? []).map((f) => [f.field_key, f]));
  const sections = [...(def.form_definition?.sections ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const out: InterviewQuestion[] = [];
  for (const s of sections) {
    for (const ref of s.fields ?? []) {
      const f = byKey.get(ref.field_key);
      if (!f) continue;
      const type = (TYPES.has(f.type) ? f.type : f.type === "currency" ? "number" : "text") as InterviewQuestion["type"];
      out.push({
        key: f.field_key,
        label: f.label,
        type,
        options: f.options?.map(optionText),
        required: ref.is_required ?? f.is_required ?? false,
        section: s.label,
        knockout: ref.is_knockout ? { when: normalise(ref.knockout_when?.equals ?? true), note: ref.knockout_note ?? "most carriers treat this as a decline or a graded rating." } : null,
        showWhen: ref.show_when ? { key: ref.show_when.field_key, equals: normalise(ref.show_when.equals) } : null,
        help: f.help_text ?? null,
        persistency: f.persistency === true,
        appliesTo: ref.applies_to && ref.applies_to !== "all" ? ref.applies_to : null,
      });
    }
  }
  return out;
}

/**
 * The answered questions a follow-up rule now hides (LA-3.1 "hidden answers are not stored"). The
 * same rule the interview renders with (components/app/applications/workspace/interview/
 * interview-form.tsx `isVisible`): a follow-up shows while its parent is shown and answered with the
 * value it waits for. The server runs this on every save, so a hidden answer is removed even when a
 * client forgets to say which ones it hid.
 */
export function hiddenAnswerKeys(questions: InterviewQuestion[], answers: Record<string, unknown>): string[] {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const visible = (q: InterviewQuestion, depth: number): boolean => {
    if (!q.showWhen) return true;
    const parent = byKey.get(q.showWhen.key);
    if (parent && depth < 8 && !visible(parent, depth + 1)) return false;
    const v = answers[q.showWhen.key];
    return v !== null && v !== undefined && String(v) === String(q.showWhen.equals);
  };
  return questions.filter((q) => q.key in answers && !visible(q, 0)).map((q) => q.key);
}

/** What "Applies to" is decided on. `null` is not known yet. */
export type InsuredFacts = { age: number | null; tobacco: boolean | null };

function yesNo(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}

/** Age last birthday on `today` from a YYYY-MM-DD date of birth. */
export function ageOn(dob: unknown, today: Date = new Date()): number | null {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const had = today.getMonth() + 1 > m || (today.getMonth() + 1 === m && today.getDate() >= d);
  const age = today.getFullYear() - y - (had ? 0 : 1);
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * The insured's age (from the application's date of birth) and tobacco use: the interview's own
 * `tobacco` answer when it has one, else the application's `insured.tobacco`.
 */
export function insuredFacts(values: Record<string, { value: unknown } | undefined>, answers: Record<string, { value: unknown } | undefined>, today?: Date): InsuredFacts {
  const fromAnswer = yesNo(answers.tobacco?.value);
  return { age: ageOn(values["insured.dob"]?.value, today), tobacco: fromAnswer ?? yesNo(values["insured.tobacco"]?.value) };
}

/**
 * Whether a question is asked of this insured. A fact nobody has entered yet never hides a
 * question — the agent asks it rather than skip something the carrier may need.
 */
export function appliesToInsured(q: InterviewQuestion, facts: InsuredFacts): boolean {
  switch (q.appliesTo) {
    case "age_50_plus": return facts.age === null || facts.age >= 50;
    case "age_under_50": return facts.age === null || facts.age < 50;
    case "tobacco": return facts.tobacco !== false;
    default: return true;
  }
}

/**
 * The required questions still unanswered, by the rule the Interview step shows (interview-form.tsx
 * `interviewProgress`): asked of this insured, visible given the answers so far, required, and empty.
 * A required medication list needs at least one row. The server checks this before it completes an
 * interview, so completion no longer rests on the client alone.
 */
export function missingRequiredAnswers(questions: InterviewQuestion[], answers: Record<string, unknown>, medicationCount: number, facts: InsuredFacts): InterviewQuestion[] {
  const asked = questions.filter((q) => appliesToInsured(q, facts));
  const byKey = new Map(asked.map((q) => [q.key, q]));
  const visible = (q: InterviewQuestion, depth: number): boolean => {
    if (!q.showWhen) return true;
    const parent = byKey.get(q.showWhen.key);
    if (parent && depth < 8 && !visible(parent, depth + 1)) return false;
    const v = answers[q.showWhen.key];
    return v !== null && v !== undefined && String(v) === String(q.showWhen.equals);
  };
  const answered = (q: InterviewQuestion) => {
    if (q.type === "medication_list") return medicationCount > 0;
    const v = answers[q.key];
    return !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  };
  return asked.filter((q) => q.required && visible(q, 0) && !answered(q));
}

/** Required canonical keys of an application field set (LA-3.7). */
export function fieldSetRequired(def: StoredDefinition | null | undefined): string[] {
  return Array.isArray(def?.required) ? def.required.filter((k): k is string => typeof k === "string") : [];
}
