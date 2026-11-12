import type { TemplateFormDefinition, TemplateFormField } from "./constants";
import { logicHolds } from "./logic.ts";

/**
 * Whether a placed question shows for these answers. Format 2 first (its `logic`, and the page skip
 * effectiveTemplateForm copies onto it); else the format-1 `show_when`, read exactly as before.
 */
export function templateFormFieldVisible(field: TemplateFormField, values: Record<string, unknown>) {
  if (field.page_skip && field.page_skip.rules.length && logicHolds(field.page_skip, values)) return false;
  if (field.logic && field.logic.rules.length) return logicHolds(field.logic, values);
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
      // A skipped page clears every answer on it (format 2), whether or not the form was made effective.
      const skipped = Boolean(section.skip_when && section.skip_when.rules.length && logicHolds(section.skip_when, next));
      for (const field of section.fields) {
        if ((skipped || !templateFormFieldVisible(field, next)) && Object.prototype.hasOwnProperty.call(next, field.field_key)) {
          delete next[field.field_key];
          changed = true;
        }
      }
    }
  }
  return next;
}
