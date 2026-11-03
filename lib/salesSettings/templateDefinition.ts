// LA-3.1 / 3.4 / 3.7 · the Settings builders' working copy of a sales template, and the one-way trips
// between it and the stored LA-1.4 definition. Pure and client-safe.
//
// The builder never renders from its own model: the preview converts the draft back to a stored
// definition (definitionFromDraft) and renders it through interviewQuestions() — the converter the
// interview itself uses — so what the owner previews is what the agent will be asked.

import { CANONICAL_GROUPS, isSensitiveKey, type FieldInput } from "../applications/constants.ts";
import type { StoredDefinition } from "../applications/templates.ts";
import type { InterviewQuestion } from "../applications/types.ts";
import { APPLIES_TO, FIELD_SET_KEYS, PERSISTENCY_KEYS, type UwFieldType } from "./templateSchemas.ts";

export type AppliesTo = (typeof APPLIES_TO)[number];

export type UwQuestion = {
  key: string;
  label: string;
  type: UwFieldType;
  options: string[];
  help: string | null;
  required: boolean;
  persistency: boolean;
  /** section_key */
  section: string;
  knockout: { when: "true" | "false"; note: string } | null;
  showWhen: { key: string; equals: string } | null;
  appliesTo: AppliesTo;
  validation?: Record<string, unknown>;
};
export type UwSection = { key: string; label: string };
export type UwDraft = { sections: UwSection[]; questions: UwQuestion[] };

type StoredField = NonNullable<StoredDefinition["fields"]>[number] & { validation?: Record<string, unknown> };
type StoredFormField = {
  field_key: string;
  is_required?: boolean;
  show_when?: { field_key: string; equals: unknown } | null;
  is_knockout?: boolean;
  knockout_when?: { equals: unknown } | null;
  knockout_note?: string | null;
  applies_to?: AppliesTo;
};

const UW_TYPES = new Set<string>(["boolean", "single_select", "multi_select", "number", "date", "text", "long_text", "medication_list", "currency"]);
export const hasChoices = (type: UwFieldType) => type === "single_select" || type === "multi_select";

const asBoolString = (v: unknown): "true" | "false" => (v === false || v === "false" ? "false" : "true");

/** Stored definition → the builder's draft, in section order then form order. */
export function draftFromDefinition(def: StoredDefinition | null | undefined): UwDraft {
  const fields = new Map((def?.fields ?? []).map((f) => [f.field_key, f as StoredField]));
  const sections = [...(def?.form_definition?.sections ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const out: UwDraft = { sections: sections.map((s) => ({ key: s.section_key, label: s.label })), questions: [] };
  const placed = new Set<string>();
  for (const s of sections) {
    for (const raw of (s.fields ?? []) as StoredFormField[]) {
      const f = fields.get(raw.field_key);
      if (!f || placed.has(f.field_key)) continue;
      placed.add(f.field_key);
      out.questions.push({
        key: f.field_key,
        label: f.label,
        type: (UW_TYPES.has(f.type) ? f.type : "text") as UwFieldType,
        options: (f.options ?? []).map((o) => String(o)),
        help: f.help_text ?? null,
        required: raw.is_required ?? f.is_required ?? false,
        persistency: f.persistency === true,
        section: s.section_key,
        knockout: raw.is_knockout ? { when: asBoolString(raw.knockout_when?.equals ?? "true"), note: raw.knockout_note ?? "" } : null,
        showWhen: raw.show_when ? { key: raw.show_when.field_key, equals: String(raw.show_when.equals) } : null,
        appliesTo: raw.applies_to ?? "all",
        ...(f.validation ? { validation: f.validation } : {}),
      });
    }
  }
  return out;
}

/** The builder's draft → the stored LA-1.4 definition (sort orders renumbered in tens). */
export function definitionFromDraft(draft: UwDraft): StoredDefinition {
  const ordered = orderBySection(draft);
  return {
    fields: ordered.questions.map((q, i) => ({
      field_key: q.key,
      label: q.label,
      type: q.type,
      is_required: q.required,
      options: hasChoices(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
      sort_order: (i + 1) * 10,
      help_text: q.help?.trim() ? q.help.trim() : null,
      ...(q.persistency ? { persistency: true } : {}),
      ...(q.validation ? { validation: q.validation } : {}),
    })),
    form_definition: {
      sections: ordered.sections.map((s, i) => ({
        section_key: s.key,
        label: s.label,
        sort_order: (i + 1) * 10,
        fields: ordered.questions.filter((q) => q.section === s.key).map((q) => ({
          field_key: q.key,
          is_required: q.required,
          show_when: q.showWhen ? { field_key: q.showWhen.key, equals: q.showWhen.equals } : null,
          ...(q.knockout && q.type === "boolean" ? { is_knockout: true, knockout_when: { equals: q.knockout.when }, knockout_note: q.knockout.note } : {}),
          ...(q.appliesTo !== "all" ? { applies_to: q.appliesTo } : {}),
        })),
      })),
    },
  } as StoredDefinition;
}

/** Questions regrouped so each section's questions are contiguous, in section order. */
export function orderBySection(draft: UwDraft): UwDraft {
  const known = new Set(draft.sections.map((s) => s.key));
  const questions = draft.sections.flatMap((s) => draft.questions.filter((q) => q.section === s.key));
  const orphans = draft.questions.filter((q) => !known.has(q.section));
  return { sections: draft.sections, questions: [...questions, ...orphans] };
}

export function knockoutCount(def: StoredDefinition | null | undefined) {
  return (def?.form_definition?.sections ?? []).reduce((n, s) => n + ((s.fields ?? []) as StoredFormField[]).filter((f) => f.is_knockout).length, 0);
}

export function questionCount(def: StoredDefinition | null | undefined) {
  return def?.fields?.length ?? 0;
}

export const isLockedPersistency = (q: Pick<UwQuestion, "key" | "persistency">) => q.persistency && (PERSISTENCY_KEYS as readonly string[]).includes(q.key);

/** A key no question uses yet, from the question text. */
export function freshKey(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "") || "question").slice(0, 40);
  const start = base.length >= 2 ? base : `q_${base}`;
  if (!used.has(start)) return start;
  for (let n = 2; ; n += 1) if (!used.has(`${start}_${n}`)) return `${start}_${n}`;
}

/** The five persistency questions, exactly as the platform seeds word them (20260926100100). */
export const PERSISTENCY_SEED: UwQuestion[] = [
  { key: "ss_deposit_day", label: "When does your Social Security arrive?", type: "single_select", options: ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"], help: "Sets the draft date — the biggest lever on month-4 lapse.", required: true, persistency: true, section: "before", knockout: null, showWhen: null, appliesTo: "all" },
  { key: "deposit_account", label: "Is the account you'll pay from the one it lands in?", type: "boolean", options: [], help: null, required: true, persistency: true, section: "before", knockout: null, showWhen: null, appliesTo: "all" },
  { key: "decision_maker", label: "Does anyone else need to be on this call?", type: "boolean", options: [], help: null, required: false, persistency: true, section: "before", knockout: null, showWhen: null, appliesTo: "all" },
  { key: "existing_coverage", label: "Do you have any life insurance now?", type: "boolean", options: [], help: "A yes brings up the replacement notice.", required: true, persistency: true, section: "before", knockout: null, showWhen: null, appliesTo: "all" },
  { key: "can_receive_text", label: "Can you get a text or email without hanging up?", type: "boolean", options: [], help: null, required: false, persistency: true, section: "before", knockout: null, showWhen: null, appliesTo: "all" },
];

/** A new underwriting template: the five persistency questions, nothing else. */
export function newUnderwritingDefinition(): StoredDefinition {
  return definitionFromDraft({ sections: [{ key: "before", label: "Before we start" }], questions: PERSISTENCY_SEED.map((q) => ({ ...q, options: [...q.options] })) });
}

/** The design fixtures' view-model questions → a stored definition (sample mode only). */
export function definitionFromInterviewQuestions(qs: InterviewQuestion[]): StoredDefinition {
  const sections: UwSection[] = [];
  const keyOf = new Map<string, string>();
  for (const q of qs) {
    if (keyOf.has(q.section)) continue;
    const key = freshKey(q.section, keyOf.values());
    keyOf.set(q.section, key);
    sections.push({ key, label: q.section });
  }
  return definitionFromDraft({
    sections,
    questions: qs.map((q) => ({
      key: q.key, label: q.label, type: q.type as UwFieldType, options: q.options ?? [], help: q.help ?? null, required: Boolean(q.required),
      persistency: Boolean(q.persistency), section: keyOf.get(q.section) ?? sections[0]?.key ?? "section",
      knockout: q.knockout && q.type === "boolean" ? { when: asBoolString(q.knockout.when), note: q.knockout.note } : null,
      showWhen: q.showWhen ? { key: q.showWhen.key, equals: String(q.showWhen.equals) } : null, appliesTo: "all",
    })),
  });
}

// ── quotation templates (LA-3.4) ───────────────────────────────────────────

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

type QuoteInput = {
  key: string;
  title: string;
  short: string;
  hint: string;
  field: { label: string; type: "date" | "single_select" | "multi_select" | "boolean" | "currency"; options: string[]; is_required: boolean };
};

/** The inputs a quotation template can ask for, in the order the Quote step asks them. */
export const QUOTE_INPUTS: QuoteInput[] = [
  { key: "dob", title: "Date of birth", short: "DOB", hint: "Age is derived from it. Nothing is priced from an age typed by hand.", field: { label: "Date of birth", type: "date", options: [], is_required: true } },
  { key: "gender", title: "Gender", short: "gender", hint: "Switch it off when the carrier rates this product the same for everyone.", field: { label: "Gender", type: "single_select", options: ["Male", "Female"], is_required: true } },
  { key: "state", title: "State", short: "state", hint: "Sets the rate card and the disclosure set at the same time.", field: { label: "State", type: "single_select", options: STATES, is_required: true } },
  { key: "tobacco", title: "Tobacco use", short: "tobacco", hint: "Any use in the last twelve months counts, cigars included.", field: { label: "Tobacco or nicotine in the last 12 months", type: "boolean", options: [], is_required: true } },
  { key: "face_amount", title: "Face amount", short: "face amount", hint: "The premium is read per $1,000, so this is what it is read against.", field: { label: "Face amount", type: "currency", options: [], is_required: true } },
  { key: "target_premium", title: "Target premium", short: "target premium", hint: "For a client who names a dollar a month instead of an amount of coverage.", field: { label: "Target monthly premium", type: "currency", options: [], is_required: false } },
  { key: "tier", title: "Rate tier", short: "tier", hint: "Level, graded and guaranteed issue are three different rate cards.", field: { label: "Tier", type: "single_select", options: ["level", "graded", "modified", "gi"], is_required: true } },
  { key: "riders", title: "Riders", short: "riders", hint: "Accidental death and child riders change the number the agent types in.", field: { label: "Riders", type: "multi_select", options: ["Accidental death", "Child rider", "Grandchild rider", "Terminal illness", "Waiver of premium"], is_required: false } },
];

type QuoteDef = StoredDefinition & { valid_days?: number };

export function quoteInputsOn(def: StoredDefinition | null | undefined): string[] {
  const keys = new Set((def?.fields ?? []).map((f) => f.field_key));
  return QUOTE_INPUTS.filter((i) => keys.has(i.key)).map((i) => i.key);
}

/** "DOB, state, tobacco, face amount" — every input the template asks, catalogue inputs first. */
export function quoteInputsSummary(def: StoredDefinition | null | undefined) {
  const on = new Set(quoteInputsOn(def));
  const known = new Set(QUOTE_INPUTS.map((i) => i.key));
  const parts = [...QUOTE_INPUTS.filter((i) => on.has(i.key)).map((i) => i.short), ...(def?.fields ?? []).filter((f) => !known.has(f.field_key)).map((f) => f.label.toLowerCase())];
  const text = parts.join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Nothing asked";
}

/** A new quotation definition with exactly `on` switched on; any non-catalogue field is kept as it was. */
export function withQuoteInputs(def: StoredDefinition | null | undefined, on: readonly string[], ageBasis: "nearest" | "last", validDays: number): QuoteDef {
  const existing = new Map((def?.fields ?? []).map((f) => [f.field_key, f]));
  const known = new Set(QUOTE_INPUTS.map((i) => i.key));
  const wanted = new Set(on);
  const catalogue = QUOTE_INPUTS.filter((i) => wanted.has(i.key)).map((i) => existing.get(i.key) ?? { field_key: i.key, ...i.field, help_text: null, sort_order: 0 });
  const others = (def?.fields ?? []).filter((f) => !known.has(f.field_key));
  const fields = [...catalogue, ...others].map((f, idx) => ({ ...f, options: (f.options ?? []).map(String), sort_order: (idx + 1) * 10 }));
  const section = def?.form_definition?.sections?.[0];
  return {
    age_basis: ageBasis,
    valid_days: validDays,
    fields,
    form_definition: {
      sections: [{
        section_key: section?.section_key ?? "quote",
        label: section?.label ?? "Quote",
        sort_order: 10,
        fields: fields.map((f) => ({ field_key: f.field_key, is_required: f.is_required ?? false, show_when: null })),
      }],
    },
  } as QuoteDef;
}

export const quoteValidDays = (def: StoredDefinition | null | undefined) => {
  const v = (def as QuoteDef | null | undefined)?.valid_days;
  return v === 14 || v === 60 ? v : 30;
};

/** The inputs a quote cannot be saved without (templateSchemas refuses a template missing either). */
export const ALWAYS_ASKED_INPUTS: readonly string[] = ["dob", "face_amount"];

/**
 * One input as the quotation editor holds it (LA-3.4 `quotation_template_field`): the carrier's own
 * wording (`label`), its choices, whether it blocks Save quote, the note the agent reads under it,
 * and whether it is asked at all. `custom` marks an input the agency added itself; a catalogue input
 * switched off keeps its place in the "Not asked" list and is not stored.
 */
export type QuoteDraftField = { key: string; title: string; label: string; type: string; options: string[]; required: boolean; help: string; on: boolean; custom: boolean };

/** The types an agency's own input may take: the ones the Quote step can draw (rating-inputs.tsx). */
export const CUSTOM_QUOTE_TYPES = [
  { type: "boolean", label: "Yes / no" },
  { type: "single_select", label: "One choice" },
  { type: "number", label: "Number" },
  { type: "currency", label: "Dollar amount" },
  { type: "date", label: "Date" },
  { type: "text", label: "Short text" },
] as const;

/** The draft list for a stored definition: asked inputs in their stored order, then the catalogue inputs it does not ask. */
export function quoteDraftFields(def: StoredDefinition | null | undefined): QuoteDraftField[] {
  const catalogue = new Map(QUOTE_INPUTS.map((i) => [i.key, i]));
  const refs = new Map((def?.form_definition?.sections ?? []).flatMap((s) => s.fields ?? []).map((r) => [r.field_key, r]));
  const stored = [...(def?.fields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const asked: QuoteDraftField[] = stored.map((f) => {
    const input = catalogue.get(f.field_key);
    return {
      key: f.field_key,
      title: input?.title ?? f.label,
      label: f.label || input?.field.label || f.field_key,
      type: f.type,
      options: (f.options ?? []).map(String),
      required: ALWAYS_ASKED_INPUTS.includes(f.field_key) || Boolean(refs.get(f.field_key)?.is_required ?? f.is_required),
      help: f.help_text ?? "",
      on: true,
      custom: !input,
    };
  });
  const have = new Set(asked.map((f) => f.key));
  const off = QUOTE_INPUTS.filter((i) => !have.has(i.key)).map((i) => ({
    key: i.key, title: i.title, label: i.field.label, type: i.field.type, options: [...i.field.options], required: i.field.is_required, help: "", on: false, custom: false,
  }));
  return [...asked, ...off];
}

/** The definition a draft list stores: only the asked inputs, in order; age basis and validity beside them. */
export function quoteDefinitionFrom(def: StoredDefinition | null | undefined, draft: readonly QuoteDraftField[], ageBasis: "nearest" | "last", validDays: number): QuoteDef {
  const asked = draft.filter((f) => f.on);
  const fields = asked.map((f, idx) => ({
    field_key: f.key,
    label: f.label.trim(),
    type: f.type,
    options: f.options.map((o) => o.trim()).filter(Boolean),
    is_required: ALWAYS_ASKED_INPUTS.includes(f.key) || f.required,
    help_text: f.help.trim() || null,
    sort_order: (idx + 1) * 10,
  }));
  const section = def?.form_definition?.sections?.[0];
  return {
    age_basis: ageBasis,
    valid_days: validDays,
    fields,
    form_definition: {
      sections: [{
        section_key: section?.section_key ?? "quote",
        label: section?.label ?? "Quote",
        sort_order: 10,
        fields: fields.map((f) => ({ field_key: f.field_key, is_required: f.is_required, show_when: null })),
      }],
    },
  } as QuoteDef;
}

/** A key for an agency's own input, from its wording: lowercase words joined by "_", never one already used. */
export function customQuoteKey(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  if (!/^[a-z]/.test(base)) base = `q_${base}`.replace(/_+$/, "");
  if (base.length < 2) base = "q_input";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  return key;
}

/** What the editor refuses before the server does: blank wording, and a choice input with nothing to choose. */
export function quoteDraftProblem(draft: readonly QuoteDraftField[]): string | null {
  for (const f of draft.filter((x) => x.on)) {
    if (!f.label.trim()) return `${f.title || "An input"} needs the words the agent reads`;
    if (f.custom && f.type === "single_select" && !f.options.some((o) => o.trim())) return `${f.label} is a choice, so give it at least one option`;
  }
  return null;
}

// ── application field sets (LA-3.7) ────────────────────────────────────────

export type FieldSetEntry = {
  key: string; canonicalLabel: string; label: string; typeLabel: string; required: boolean; sensitive: boolean;
  /** The line the agent reads under the field ("" for none). */
  help: string;
  /** Its section: a canonical group key, or "pay". */
  group: string;
  /** Set for the agency's own question; null for a built-in field. */
  custom: FieldSetCustom | null;
};

const INPUT_LABEL: Record<FieldInput, string> = {
  text: "Text", date: "Date", select: "Choice", number: "Number", tel: "Phone", email: "Email", boolean: "Yes / no", money: "Currency", ssn: "Masked text", state: "State",
};
const PAYMENT_META: Record<string, { label: string; type: string }> = {
  "pay.method": { label: "Payment method", type: "Choice" },
  "pay.routing_number": { label: "Routing number", type: "Masked text" },
  "pay.account_number": { label: "Account number", type: "Masked text" },
  "pay.account_type": { label: "Account type", type: "Choice" },
  "pay.bank_name": { label: "Bank name", type: "Text" },
  "pay.name_on_account": { label: "Name on the account", type: "Text" },
  "pay.card_number": { label: "Card number", type: "Masked text" },
  "pay.card_exp": { label: "Card expiry", type: "Text" },
  "pay.card_brand": { label: "Card brand", type: "Choice" },
  "pay.name_on_card": { label: "Name on the card", type: "Text" },
  "pay.billing_frequency": { label: "Billing frequency", type: "Choice" },
  "pay.draft_day": { label: "Draft day", type: "Number" },
};
const CANONICAL = new Map(CANONICAL_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));

export function fieldMeta(key: string) {
  const c = CANONICAL.get(key);
  if (c) return { label: c.label, type: c.sensitive || isSensitiveKey(key) ? "Masked text" : INPUT_LABEL[c.input] };
  const p = PAYMENT_META[key];
  return p ?? { label: key, type: "Text" };
}

/** An agency's own question (templateSchemas CUSTOM_FIELD_TYPES): its type, choices and section. */
export type FieldSetCustom = { type: string; options: string[] };
type CustomDef = { key: string; label: string; type: string; options?: string[]; group: string };
type FieldSetDef = { required?: string[]; optional?: string[]; labels?: Record<string, string>; order?: string[]; help?: Record<string, string>; custom?: CustomDef[] };

export const CUSTOM_TYPE_LABEL: Record<string, string> = {
  text: "Short text", long_text: "Long text", date: "Date", number: "Number", currency: "Dollar amount", choice: "One choice", yes_no: "Yes / no", state: "State", phone: "Phone", email: "Email",
};

/** The section a built-in key sits in: its canonical group, or "pay" for the payment keys. */
export function groupOfKey(key: string) {
  return CANONICAL_GROUPS.find((g) => g.fields.some((f) => f.key === key))?.key ?? (key.startsWith("pay.") ? "pay" : "custom");
}

/**
 * The set's fields in the order the agent sees them (owner 2026-10-30): the stored `order` first,
 * then anything it does not name in canonical order, each section's own questions after its built-in
 * fields. Each entry carries its label, help line and handling.
 */
export function fieldSetEntries(def: FieldSetDef | StoredDefinition | null | undefined): FieldSetEntry[] {
  const d = (def ?? {}) as FieldSetDef;
  const required = new Set(d.required ?? []);
  const inSet = new Set([...(d.required ?? []), ...(d.optional ?? [])]);
  const custom = new Map((Array.isArray(d.custom) ? d.custom : []).filter((c) => inSet.has(c.key)).map((c) => [c.key, c]));
  const groups = [...CANONICAL_GROUPS.map((g) => g.key), "pay"];
  const canonical = groups.flatMap((g) => [...FIELD_SET_KEYS.filter((k) => groupOfKey(k) === g && inSet.has(k)), ...[...custom.values()].filter((c) => c.group === g).map((c) => c.key)]);
  const named = (Array.isArray(d.order) ? d.order : []).filter((k) => canonical.includes(k));
  const keys = [...new Set([...named, ...canonical])];
  return keys.map((k) => {
    const c = custom.get(k);
    const help = d.help?.[k] ?? "";
    if (c) return { key: k, canonicalLabel: c.label, label: c.label, typeLabel: CUSTOM_TYPE_LABEL[c.type] ?? c.type, required: required.has(k), sensitive: false, help, group: c.group, custom: { type: c.type, options: c.options ?? [] } };
    const meta = fieldMeta(k);
    return { key: k, canonicalLabel: meta.label, label: d.labels?.[k] ?? meta.label, typeLabel: meta.type, required: required.has(k), sensitive: isSensitiveKey(k), help, group: groupOfKey(k), custom: null };
  });
}

export function fieldSetFromEntries(entries: (Pick<FieldSetEntry, "key" | "label" | "canonicalLabel" | "required"> & Partial<Pick<FieldSetEntry, "help" | "group" | "custom">>)[]) {
  const labels: Record<string, string> = {};
  const help: Record<string, string> = {};
  const custom: CustomDef[] = [];
  for (const e of entries) {
    if (e.custom) {
      custom.push({ key: e.key, label: e.label.trim(), type: e.custom.type, ...(e.custom.type === "choice" ? { options: e.custom.options.map((o) => o.trim()).filter(Boolean) } : {}), group: e.group ?? "insured" });
    } else if (e.label.trim() && e.label.trim() !== e.canonicalLabel) labels[e.key] = e.label.trim();
    if (e.help?.trim()) help[e.key] = e.help.trim();
  }
  return {
    required: entries.filter((e) => e.required).map((e) => e.key),
    optional: entries.filter((e) => !e.required).map((e) => e.key),
    ...(Object.keys(labels).length ? { labels } : {}),
    order: entries.map((e) => e.key),
    ...(Object.keys(help).length ? { help } : {}),
    ...(custom.length ? { custom } : {}),
  };
}
