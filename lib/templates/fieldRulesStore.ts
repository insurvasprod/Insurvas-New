// Format 2 keeps two question rules in the form definition, not on the lead field: server intake's
// validation list (validateValidation in lib/agentTemplates/service.ts) accepts only min / max /
// lengths / ages / pattern, and refuses anything else. The builder edits them on the field like any
// other rule; these move them out on save and back in on load. Client-safe.

import type { TemplateField, TemplateFormDefinition, TemplateValidation } from "./constants.ts";

const MOVED = ["no_future", "message"] as const;
/** The validation keys server intake accepts today; anything else is dropped before a save. */
export const INTAKE_VALIDATION_KEYS = ["min", "max", "min_length", "max_length", "age_min", "age_max", "pattern"] as const;

/** The fields as intake takes them, and the form carrying the moved rules. */
export function splitFieldRules(fields: TemplateField[], form: TemplateFormDefinition): { fields: TemplateField[]; form: TemplateFormDefinition } {
  const rules: NonNullable<TemplateFormDefinition["field_rules"]> = {};
  const out = fields.map((field) => {
    const validation = (field.validation ?? {}) as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const key of INTAKE_VALIDATION_KEYS) if (validation[key] !== undefined && validation[key] !== null && validation[key] !== "") kept[key] = validation[key];
    const moved: Pick<TemplateValidation, "no_future" | "message"> = {};
    if (validation.no_future === true) moved.no_future = true;
    if (typeof validation.message === "string" && validation.message.trim()) moved.message = validation.message.trim().slice(0, 300);
    if (Object.keys(moved).length) rules[field.field_key] = moved;
    return { ...field, validation: kept as TemplateValidation };
  });
  const next: TemplateFormDefinition = { ...form };
  if (Object.keys(rules).length) next.field_rules = rules; else delete next.field_rules;
  return { fields: out, form: next };
}

/** The fields with the form's moved rules back in their validation, for the builder. */
export function mergeFieldRules(fields: TemplateField[], form: TemplateFormDefinition): TemplateField[] {
  const rules = form.field_rules ?? {};
  return fields.map((field) => {
    const moved = rules[field.field_key];
    if (!moved) return field;
    const validation: TemplateValidation = { ...(field.validation ?? {}) };
    for (const key of MOVED) if (moved[key] !== undefined) (validation as Record<string, unknown>)[key] = moved[key];
    return { ...field, validation };
  });
}
