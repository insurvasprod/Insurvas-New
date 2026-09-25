import type { TemplateFormDefinition, TemplateFormField } from "./constants";

export function templateFormFieldVisible(field: TemplateFormField, values: Record<string, unknown>) {
  const condition = field.show_when ?? field.conditional_on;
  if (!condition) return true;
  const value = values[condition.field_key];
  return Array.isArray(value) ? value.includes(condition.equals) : String(value ?? "") === condition.equals;
}

/** Remove values that are no longer part of the submitted form after a controlling answer changes. */
export function pruneHiddenTemplateValues(form: TemplateFormDefinition, values: Record<string, unknown>) {
  const next = { ...values };
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of form.sections) {
      for (const field of section.fields) {
        if (!templateFormFieldVisible(field, next) && Object.prototype.hasOwnProperty.call(next, field.field_key)) {
          delete next[field.field_key];
          changed = true;
        }
      }
    }
  }
  return next;
}
