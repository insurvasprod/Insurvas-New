import type { TemplateField, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";

export type VerificationState = "confirmed" | "corrected" | "outstanding";
export type VerificationFieldState = { field_key: string; state: VerificationState; is_required: boolean; is_visible: boolean };

export function fieldVisible(field: TemplateFormField, values: Record<string, unknown>) {
  const condition = field.show_when ?? field.conditional_on;
  if (!condition) return true;
  const value = values[condition.field_key];
  return Array.isArray(value) ? value.includes(condition.equals) : String(value ?? "") === condition.equals;
}

export function formFieldEntries(form: TemplateFormDefinition, fields: TemplateField[], values: Record<string, unknown>) {
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  return form.sections.map((section) => ({
    ...section,
    fields: section.fields.flatMap((formField) => {
      const field = fieldMap.get(formField.field_key);
      return field && fieldVisible(formField, values) ? [{ formField, field }] : [];
    }),
  }));
}

export function requiredVisibleKeys(form: TemplateFormDefinition, fields: TemplateField[], values: Record<string, unknown>) {
  return formFieldEntries(form, fields, values).flatMap((section) => section.fields.filter(({ formField, field }) => formField.is_required || field.is_required).map(({ field }) => field.field_key));
}

export function visibleKeys(form: TemplateFormDefinition, fields: TemplateField[], values: Record<string, unknown>) {
  return formFieldEntries(form, fields, values).flatMap((section) => section.fields.map(({ field }) => field.field_key));
}

export function verificationProgress(states: VerificationFieldState[], requiredKeys: string[], visibleKeys: string[]) {
  const visible = new Set(visibleKeys);
  const required = requiredKeys.filter((key) => visible.has(key));
  if (required.length === 0) return 100;
  const confirmed = states.filter((field) => required.includes(field.field_key) && ["confirmed", "corrected"].includes(field.state)).length;
  return Math.round((confirmed / required.length) * 100);
}

export function sectionComplete(states: VerificationFieldState[], keys: string[]) {
  const relevant = states.filter((field) => keys.includes(field.field_key) && field.is_required && field.is_visible);
  return relevant.length > 0 && relevant.every((field) => ["confirmed", "corrected"].includes(field.state));
}
