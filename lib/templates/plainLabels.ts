// Form templates, variant C (docs/design/specs/form-templates.md): the words the settings page uses for
// answer types and for "must it be answered". Display only — the stored type values and the two
// is_required flags are untouched. Client-safe.
import type { TemplateField, TemplateFieldType, TemplateFormField } from "./constants";

/** What a partner answers with, in plain words, and a short example. */
export const TEMPLATE_FIELD_PLAIN: Record<TemplateFieldType, { label: string; hint: string }> = {
  text: { label: "Words", hint: "a short answer" },
  long_text: { label: "Long text", hint: "a few sentences" },
  number: { label: "A number", hint: "like 3 or 42" },
  date: { label: "A date", hint: "like a birthday" },
  currency: { label: "Money", hint: "like $25,000" },
  phone: { label: "Phone number", hint: "checked as a phone" },
  email: { label: "Email address", hint: "checked as an email" },
  ssn: { label: "Social Security number", hint: "shown masked" },
  bank_routing: { label: "Bank routing number", hint: "9 digits, checked" },
  bank_account: { label: "Bank account number", hint: "digits only" },
  boolean: { label: "Yes or no", hint: "one of two" },
  single_select: { label: "Pick one", hint: "from a list" },
  multi_select: { label: "Pick several", hint: "from a list" },
};

/** The answer types offered first; the rest sit behind "More kinds". */
export const COMMON_FIELD_TYPES: readonly TemplateFieldType[] = ["text", "number", "currency", "date", "boolean", "single_select", "phone", "email"];

/**
 * One choice instead of two switches. "always": the lead field itself is required, so no lead saves
 * without it from any source. "form": only partners must answer it on this form. "no": neither.
 */
export type RequiredChoice = "always" | "form" | "no";

export const REQUIRED_CHOICE_LABELS: Record<RequiredChoice, string> = {
  always: "Yes, always",
  form: "Only on this form",
  no: "No, they can skip",
};

export function requiredChoice(field: Pick<TemplateField, "is_required">, placement: Pick<TemplateFormField, "is_required"> | null): RequiredChoice {
  if (field.is_required) return "always";
  if (placement?.is_required) return "form";
  return "no";
}

/** A field kept on the lead only has no form to be required on, so "Only here" is not offered. */
export function requiredChoices(placement: Pick<TemplateFormField, "is_required"> | null): RequiredChoice[] {
  return placement ? ["always", "form", "no"] : ["always", "no"];
}

/** The two flags a choice sets. `placement` is null when the field is not on the form. */
export function applyRequiredChoice(choice: RequiredChoice, onForm: boolean): { field: boolean; placement: boolean | null } {
  if (!onForm) return { field: choice === "always", placement: null };
  return { field: choice === "always", placement: choice === "form" };
}
