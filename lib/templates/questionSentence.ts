// Form templates, variant C: one plain sentence that says what partners will experience with a
// question, built from its settings, so the owner reads the result instead of decoding switches.
// Client-safe; the settings panel shows it above the question's controls and updates it live.
import type { TemplateField, TemplateFormField } from "./constants";
import { requiredChoice } from "./plainLabels.ts";

/** The question a show-when points at, resolved by the caller (labels live on the field list). */
export type ShowWhenLabel = { label: string; equals: string } | null;

const money = (value: number) => "$" + value.toLocaleString("en-US");

function answerPhrase(field: TemplateField): string {
  const choices = field.options.length;
  switch (field.type) {
    case "text": return "type a short answer";
    case "long_text": return "write a few sentences";
    case "number": return "type a number";
    case "date": return "pick a date";
    case "currency": return "type an amount of money";
    case "phone": return "type a phone number";
    case "email": return "type an email address";
    case "ssn": return "type a Social Security number, shown masked";
    case "bank_routing": return "type a 9-digit bank routing number";
    case "bank_account": return "type a bank account number";
    case "boolean": return "pick Yes or No";
    case "single_select":
    case "multi_select":
      if (!choices) return "pick from a list that has no choices yet";
      if (choices === 1) return "can only pick its one choice";
      return `pick ${field.type === "single_select" ? "one" : "any"} of ${choices} choices`;
  }
}

function range(low: string | null, high: string | null, unit: string) {
  if (low && high) return `${low} to ${high}${unit}`;
  if (low) return `at least ${low}${unit}`;
  if (high) return `at most ${high}${unit}`;
  return null;
}

function limitSentence(field: TemplateField): string | null {
  const v = field.validation ?? {};
  const num = (n: number | undefined) => (typeof n === "number" ? n : null);
  if (field.type === "date") {
    const span = range(num(v.age_min)?.toString() ?? null, num(v.age_max)?.toString() ?? null, " years old");
    return span ? `They must be ${span}.` : null;
  }
  if (field.type === "number" || field.type === "currency") {
    const show = (n: number | null) => (n === null ? null : field.type === "currency" ? money(n) : n.toLocaleString("en-US"));
    const span = range(show(num(v.min)), show(num(v.max)), "");
    return span ? `It must be ${span}.` : null;
  }
  if (["text", "long_text", "phone", "email", "ssn"].includes(field.type)) {
    const span = range(num(v.min_length)?.toString() ?? null, num(v.max_length)?.toString() ?? null, " characters");
    return span ? `It must be ${span} long.` : null;
  }
  return null;
}

/**
 * "Partners see “Coverage amount” and type an amount of money. It must be $10,000 to $2,000,000.
 * They can skip it." A field kept on the lead only (no placement) is described for agents instead.
 */
export function questionSentence(field: TemplateField, placement: TemplateFormField | null, showWhen: ShowWhenLabel = null): string {
  const label = field.label.trim() || "this question";
  const parts: string[] = [];
  if (!placement) {
    parts.push(`Partners never see “${label}”; your agents fill it in.`);
    parts.push(field.is_required ? "A lead can’t be saved without it." : "It can be left empty.");
    return parts.join(" ");
  }
  parts.push(`Partners see “${label}” and ${answerPhrase(field)}.`);
  const limit = limitSentence(field);
  if (limit) parts.push(limit);
  const choice = requiredChoice(field, placement);
  parts.push(choice === "always" ? "They must answer it." : choice === "form" ? "Partners must answer it here." : "They can skip it.");
  if (showWhen) {
    parts.push(showWhen.equals
      ? `They only see it after answering “${showWhen.equals}” to “${showWhen.label}”.`
      : `They only see it after answering “${showWhen.label}”.`);
  }
  return parts.join(" ");
}
