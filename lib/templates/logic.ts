// Form definition format 2 (Settings r8, Application forms A3): when a question shows, and when a
// whole page is skipped. Several rules joined by AND / OR, one level of groups, read back as one
// plain sentence. Client-safe and DB-free: the builder, the preview, the partner form (through
// visibility.ts) and the server's save check all read these functions.
//
// Compatibility: a question whose logic is one plain "is" rule is stored the format-1 way, as
// `show_when`, so every reader that predates format 2 (the agent lead form, server intake) still
// hides and shows it exactly as before. Only logic format 1 cannot say is stored as `logic`.

import { ageFromDob } from "./formats.ts";
import {
  TEMPLATE_DEFINITION_FORMAT,
  TEMPLATE_RULE_OPS,
  TEMPLATE_KEY_PATTERN,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateFormField,
  type TemplateFormSection,
  type TemplateLogic,
  type TemplateRule,
  type TemplateRuleGroup,
  type TemplateRuleOp,
} from "./constants.ts";

export const MAX_LOGIC_RULES = 20;

export function isRuleGroup(item: TemplateRule | TemplateRuleGroup): item is TemplateRuleGroup {
  return Array.isArray((item as TemplateRuleGroup).rules);
}

/** Every rule, groups opened. */
export function logicRules(logic: TemplateLogic | null | undefined): TemplateRule[] {
  if (!logic) return [];
  return logic.rules.flatMap((item) => (isRuleGroup(item) ? item.rules : [item]));
}

export function logicRuleCount(logic: TemplateLogic | null | undefined) {
  return logicRules(logic).length;
}

/** The questions a piece of logic reads. */
export function logicReferences(logic: TemplateLogic | null | undefined): string[] {
  return [...new Set(logicRules(logic).map((rule) => rule.field_key))];
}

const empty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
/** "Yes" and "true" are the same answer to a yes / no question (stored as "true" / "false"). */
const norm = (value: unknown) => {
  const text = String(value ?? "").trim();
  const lower = text.toLowerCase();
  return lower === "yes" || lower === "true" ? "true" : lower === "no" || lower === "false" ? "false" : text;
};
const sameAnswer = (answer: unknown, target: string | undefined) => {
  if (target === undefined) return false;
  return Array.isArray(answer) ? answer.some((item) => norm(item) === norm(target)) : norm(answer) === norm(target);
};
const asNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};

export function ruleHolds(rule: TemplateRule, values: Record<string, unknown>, today = new Date()): boolean {
  const answer = values[rule.field_key];
  switch (rule.op) {
    case "is": return sameAnswer(answer, rule.value);
    case "is_not": return !sameAnswer(answer, rule.value);
    case "one_of": return (rule.values ?? []).some((value) => sameAnswer(answer, value));
    case "filled": return !empty(answer);
    case "empty": return empty(answer);
    case "at_least":
    case "at_most": {
      const have = asNumber(answer);
      const limit = asNumber(rule.value);
      if (have === null || limit === null) return false;
      return rule.op === "at_least" ? have >= limit : have <= limit;
    }
    case "age_at_least":
    case "age_at_most": {
      const age = ageFromDob(answer, today);
      const limit = asNumber(rule.value);
      if (age === null || limit === null) return false;
      return rule.op === "age_at_least" ? age >= limit : age <= limit;
    }
    default: return false;
  }
}

function groupHolds(match: "all" | "any", results: boolean[]) {
  if (results.length === 0) return true;
  return match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** True when the logic is met. Empty logic is always met. */
export function logicHolds(logic: TemplateLogic | null | undefined, values: Record<string, unknown>, today = new Date()): boolean {
  if (!logic || logic.rules.length === 0) return true;
  return groupHolds(logic.match, logic.rules.map((item) => (isRuleGroup(item) ? groupHolds(item.match, item.rules.map((rule) => ruleHolds(rule, values, today))) : ruleHolds(item, values, today))));
}

/** A format-1 condition as format-2 logic. */
export function logicFromCondition(condition: { field_key: string; equals: string } | null | undefined): TemplateLogic | null {
  return condition ? { match: "all", rules: [{ field_key: condition.field_key, op: "is", value: condition.equals }] } : null;
}

/** The logic a placed question carries: its own, else its format-1 condition. */
export function placementLogic(field: Pick<TemplateFormField, "logic" | "show_when" | "conditional_on">): TemplateLogic | null {
  if (field.logic && field.logic.rules.length) return field.logic;
  return logicFromCondition(field.show_when ?? field.conditional_on ?? null);
}

/** The format-1 condition that says exactly the same, or null when format 1 cannot say it. */
export function conditionShadow(logic: TemplateLogic | null | undefined): { field_key: string; equals: string } | null {
  if (!logic || logic.rules.length !== 1) return null;
  const only = logic.rules[0];
  if (isRuleGroup(only)) return only.rules.length === 1 && only.rules[0].op === "is" && typeof only.rules[0].value === "string" ? { field_key: only.rules[0].field_key, equals: only.rules[0].value } : null;
  return only.op === "is" && typeof only.value === "string" ? { field_key: only.field_key, equals: only.value } : null;
}

/**
 * The placement with new logic, stored the most compatible way: one plain "is" rule as `show_when`
 * (no `logic` key); anything else as `logic`, with `show_when` cleared.
 */
export function withLogic(field: TemplateFormField, logic: TemplateLogic | null): TemplateFormField {
  const next: TemplateFormField = { ...field, conditional_on: null };
  delete next.logic;
  const cleaned = cleanLogic(logic);
  if (!cleaned) return { ...next, show_when: null };
  const shadow = conditionShadow(cleaned);
  // Stored exactly as picked: the rule editor offers a yes / no answer as "true" / "false", the way
  // the partner form stores it, so a format-1 reader (strict string equality) agrees.
  if (shadow) return { ...next, show_when: shadow };
  return { ...next, show_when: null, logic: cleaned };
}

/** Empty groups dropped, a group of one unwrapped; null when nothing is left. */
export function cleanLogic(logic: TemplateLogic | null | undefined): TemplateLogic | null {
  if (!logic) return null;
  const rules = logic.rules
    .map((item) => (isRuleGroup(item) ? (item.rules.length === 1 ? item.rules[0] : item.rules.length ? item : null) : item))
    .filter((item): item is TemplateRule | TemplateRuleGroup => Boolean(item));
  return rules.length ? { match: logic.match, rules } : null;
}

/** The ways a rule can test this question's answer, in the builder's words. */
export function ruleOpsFor(field: Pick<TemplateField, "type"> | null): TemplateRuleOp[] {
  if (!field) return ["filled", "empty"];
  switch (field.type) {
    case "boolean": return ["is", "filled", "empty"];
    case "single_select": return ["is", "is_not", "one_of", "filled", "empty"];
    case "multi_select": return ["is", "is_not", "filled", "empty"];
    case "number":
    case "currency": return ["is", "at_least", "at_most", "filled", "empty"];
    case "date": return ["age_at_least", "age_at_most", "filled", "empty"];
    default: return ["is", "is_not", "filled", "empty"];
  }
}

export const RULE_OP_LABELS: Record<TemplateRuleOp, string> = {
  is: "is",
  is_not: "is not",
  one_of: "is one of",
  filled: "is filled in",
  empty: "is empty",
  at_least: "is at least",
  at_most: "is at most",
  age_at_least: "age is at least",
  age_at_most: "age is at most",
};

export const ruleNeedsValue = (op: TemplateRuleOp) => op !== "filled" && op !== "empty";

/** The answers a rule may pick from, when the question has a fixed list. */
export function ruleAnswers(field: Pick<TemplateField, "type" | "options"> | null): Array<{ value: string; label: string }> | null {
  if (!field) return null;
  if (field.type === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if ((field.type === "single_select" || field.type === "multi_select") && field.options.length) return field.options.map((option) => ({ value: option, label: option }));
  return null;
}

/** A starting rule on a question: its first answer when it has a list. */
export function starterRule(field: TemplateField): TemplateRule {
  const op = ruleOpsFor(field)[0];
  const first = ruleAnswers(field)?.[0]?.value;
  return { field_key: field.field_key, op, ...(ruleNeedsValue(op) ? (op === "one_of" ? { values: first ? [first] : [] } : { value: first ?? (field.type === "date" ? "18" : "") }) : {}) };
}

const listWords = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);
const shownAnswer = (value: string | undefined) => (norm(value) === "true" ? "Yes" : norm(value) === "false" ? "No" : value ?? "");

export function ruleSentence(rule: TemplateRule, labelOf: (key: string) => string): string {
  const label = labelOf(rule.field_key);
  switch (rule.op) {
    case "is": return `${label} is ${shownAnswer(rule.value) || "empty"}`;
    case "is_not": return `${label} is not ${shownAnswer(rule.value) || "empty"}`;
    case "one_of": return `${label} is ${listWords((rule.values ?? []).map(shownAnswer)) || "one of nothing yet"}`;
    case "filled": return `${label} is filled in`;
    case "empty": return `${label} is empty`;
    case "at_least": return `${label} is at least ${rule.value ?? ""}`;
    case "at_most": return `${label} is at most ${rule.value ?? ""}`;
    case "age_at_least": return `the person is ${rule.value ?? ""} or older`;
    case "age_at_most": return `the person is ${rule.value ?? ""} or younger`;
    default: return label;
  }
}

/** "Tobacco use is Yes and (the person is 60 or older or State is FL, GA or TX)". */
export function logicSentence(logic: TemplateLogic | null | undefined, labelOf: (key: string) => string): string {
  const cleaned = cleanLogic(logic);
  if (!cleaned) return "";
  const join = (match: "all" | "any") => (match === "all" ? " and " : " or ");
  const parts = cleaned.rules.map((item) => (isRuleGroup(item) ? `(${item.rules.map((rule) => ruleSentence(rule, labelOf)).join(join(item.match))})` : ruleSentence(item, labelOf)));
  return parts.join(join(cleaned.match));
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every piece of logic on the form, for the "All logic on this form" list. */
export function formLogicList(form: TemplateFormDefinition, fields: Pick<TemplateField, "field_key" | "label">[]) {
  const labels = new Map(fields.map((field) => [field.field_key, field.label]));
  const labelOf = (key: string) => labels.get(key) ?? key;
  const out: Array<{ kind: "question" | "page"; section_key: string; field_key?: string; title: string; sentence: string }> = [];
  form.sections.forEach((section, index) => {
    for (const placed of section.fields) {
      const logic = placementLogic(placed);
      if (logic) out.push({ kind: "question", section_key: section.section_key, field_key: placed.field_key, title: labelOf(placed.field_key), sentence: capital(logicSentence(logic, labelOf)) });
    }
    if (section.skip_when && cleanLogic(section.skip_when)) out.push({ kind: "page", section_key: section.section_key, title: `Page ${index + 1} · ${section.label}`, sentence: `Skipped when ${logicSentence(section.skip_when, labelOf)}` });
  });
  return out;
}

/** Why this logic cannot be saved, or null. `known` is every question key on the form. */
export function logicProblem(logic: unknown, known: ReadonlySet<string>): string | null {
  if (logic === undefined || logic === null) return null;
  const isMatch = (value: unknown) => value === "all" || value === "any";
  if (typeof logic !== "object" || Array.isArray(logic)) return "Form logic is invalid";
  const top = logic as { match?: unknown; rules?: unknown };
  if (!isMatch(top.match) || !Array.isArray(top.rules)) return "Form logic is invalid";
  let count = 0;
  const ruleProblem = (rule: unknown): string | null => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "Form logic is invalid";
    const r = rule as { field_key?: unknown; op?: unknown; value?: unknown; values?: unknown };
    if (typeof r.field_key !== "string" || !TEMPLATE_KEY_PATTERN.test(r.field_key)) return "Form logic is invalid";
    if (!known.has(r.field_key)) return "A rule reads a question that is not on the form any more. Change or remove that rule.";
    if (typeof r.op !== "string" || !(TEMPLATE_RULE_OPS as readonly string[]).includes(r.op)) return "Form logic is invalid";
    if (r.value !== undefined && (typeof r.value !== "string" || r.value.length > 120)) return "Form logic is invalid";
    if (r.values !== undefined && (!Array.isArray(r.values) || r.values.length > 60 || r.values.some((v) => typeof v !== "string" || v.length > 120))) return "Form logic is invalid";
    count += 1;
    return null;
  };
  for (const item of top.rules) {
    if (item && typeof item === "object" && Array.isArray((item as { rules?: unknown }).rules)) {
      const group = item as { match?: unknown; rules: unknown[] };
      if (!isMatch(group.match)) return "Form logic is invalid";
      for (const rule of group.rules) { const problem = ruleProblem(rule); if (problem) return problem; }
    } else {
      const problem = ruleProblem(item);
      if (problem) return problem;
    }
  }
  if (count > MAX_LOGIC_RULES) return `A question can have at most ${MAX_LOGIC_RULES} rules`;
  return null;
}

/** Why this form's format-2 logic cannot be saved, or null. Checked again on the server. */
export function formLogicProblem(form: TemplateFormDefinition): string | null {
  const known = new Set(form.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
  for (const section of form.sections) {
    const pageProblem = logicProblem(section.skip_when, known);
    if (pageProblem) return `${section.label}: ${pageProblem}`;
    for (const placed of section.fields) {
      const problem = logicProblem(placed.logic, known);
      if (problem) return problem;
      if (logicReferences(placed.logic ?? null).includes(placed.field_key)) return "A question cannot depend on its own answer";
    }
  }
  return null;
}

/** True when the form says something only format 2 can. */
export function usesFormat2(form: TemplateFormDefinition) {
  return form.sections.some((section) => Boolean(cleanLogic(section.skip_when)) || section.fields.some((field) => Boolean(cleanLogic(field.logic))));
}

/**
 * The form as it is stored: `format` set when format 2 is used, empty logic and skip rules dropped,
 * and the computed `page_skip` never written.
 */
export function formForSave(form: TemplateFormDefinition): TemplateFormDefinition {
  const sections: TemplateFormSection[] = form.sections.map((section) => {
    const skip = cleanLogic(section.skip_when);
    const next: TemplateFormSection = { ...section, fields: section.fields.map((field) => {
      const placed: TemplateFormField = { ...field };
      delete placed.page_skip;
      const logic = cleanLogic(placed.logic);
      if (logic) placed.logic = logic; else delete placed.logic;
      return placed;
    }) };
    if (skip) next.skip_when = skip; else delete next.skip_when;
    return next;
  });
  const out: TemplateFormDefinition = { ...form, sections };
  if (usesFormat2(out)) out.format = TEMPLATE_DEFINITION_FORMAT; else delete out.format;
  return out;
}
