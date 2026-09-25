/**
 * What a form-template draft would change, read by diffing the draft against the saved copy.
 *
 * Settings → Form templates holds every edit in the browser until the owner commits, and the board
 * lists the pending changes one line each. Deriving them from the two states (rather than logging
 * each keystroke) means undoing an edit by hand removes its line, and the count on the table is the
 * number of things a commit would actually change.
 *
 * Plain module: the settings screen is a client component.
 */
import {
  TEMPLATE_FIELD_TYPE_LABELS,
  TEMPLATE_STAGE_TYPE_LABELS,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateFormField,
  type TemplateStage,
  type TemplateValidation,
} from "../templates/constants.ts";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability } from "../templates/sectionAvailability.ts";
import { TEMPLATE_SECTION_GROUPS } from "../templates/constants.ts";

export type TemplateDraft = { name: string; fields: TemplateField[]; stages: TemplateStage[]; form: TemplateFormDefinition };
export type TemplateChange = { id: string; title: string; sub?: string };

const VALIDATION_LABELS: Record<string, string> = {
  min: "minimum",
  max: "maximum",
  min_length: "minimum length",
  max_length: "maximum length",
  pattern: "pattern",
  age_min: "minimum age",
  age_max: "maximum age",
  digit_length: "digit length",
  format_mask: "format mask",
  placeholder: "placeholder",
};

const q = (text: string) => `“${text}”`;
const shown = (value: unknown) => (value === undefined || value === null || value === "" ? "none" : String(value));
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const condition = (field: TemplateFormField) => field.show_when ?? field.conditional_on ?? null;

/**
 * The date field whose age limits are the product's eligibility: a date-of-birth key first, then
 * any date field that already carries an age limit.
 */
export function eligibilityFieldKey(fields: TemplateField[]) {
  const dates = fields.filter((field) => field.type === "date");
  return (
    dates.find((field) => /(^|_)(dob|birth|birthdate|date_of_birth)(_|$)/.test(field.field_key) || /birth/.test(field.field_key))?.field_key ??
    dates.find((field) => field.validation?.age_min !== undefined || field.validation?.age_max !== undefined)?.field_key ??
    null
  );
}

function validationChanges(before: TemplateValidation | undefined, after: TemplateValidation | undefined, label: string, eligibility: boolean): TemplateChange[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out: TemplateChange[] = [];
  for (const key of keys) {
    if (shown(a[key]) === shown(b[key])) continue;
    const name = VALIDATION_LABELS[key] ?? key;
    const title = eligibility && (key === "age_min" || key === "age_max")
      ? `${capital(name)} ${shown(a[key])} → ${shown(b[key])}`
      : `${q(label)} ${name} ${shown(a[key])} → ${shown(b[key])}`;
    out.push({ id: `validation:${label}:${key}`, title });
  }
  return out;
}

export function diffTemplateDraft(saved: TemplateDraft, draft: TemplateDraft): TemplateChange[] {
  const changes: TemplateChange[] = [];
  if (saved.name.trim() !== draft.name.trim()) changes.push({ id: "name", title: `Template name ${q(saved.name)} → ${q(draft.name)}` });

  const savedFields = new Map(saved.fields.map((field) => [field.field_key, field]));
  const draftFields = new Map(draft.fields.map((field) => [field.field_key, field]));
  const eligibility = eligibilityFieldKey(draft.fields) ?? eligibilityFieldKey(saved.fields);
  const labelOf = (key: string) => draftFields.get(key)?.label ?? savedFields.get(key)?.label ?? key;

  for (const field of draft.fields) {
    const before = savedFields.get(field.field_key);
    if (!before) {
      changes.push({ id: `field+:${field.field_key}`, title: `${q(field.label)} added`, sub: field.is_required ? "Required" : "Optional" });
      continue;
    }
    if (before.label !== field.label) changes.push({ id: `label:${field.field_key}`, title: `${q(before.label)} renamed ${q(field.label)}` });
    if (before.type !== field.type)
      changes.push({ id: `type:${field.field_key}`, title: `${q(field.label)} is now ${TEMPLATE_FIELD_TYPE_LABELS[field.type] ?? field.type}`, sub: `Was ${TEMPLATE_FIELD_TYPE_LABELS[before.type] ?? before.type}` });
    if (before.is_required !== field.is_required)
      changes.push({ id: `required:${field.field_key}`, title: `${q(field.label)} made ${field.is_required ? "required" : "optional"}`, sub: `Was ${before.is_required ? "required" : "optional"}` });
    if ((before.help_text ?? "") !== (field.help_text ?? ""))
      changes.push({ id: `help:${field.field_key}`, title: `Help text for ${q(field.label)} changed`, sub: field.help_text ? field.help_text : "Removed" });
    if (before.options.join("\u0000") !== field.options.join("\u0000"))
      changes.push({ id: `options:${field.field_key}`, title: `Options for ${q(field.label)} changed`, sub: field.options.length ? field.options.join(", ") : "No options" });
    changes.push(...validationChanges(before.validation, field.validation, field.label, field.field_key === eligibility).map((change) => ({ ...change, id: `${change.id}:${field.field_key}` })));
  }
  for (const field of saved.fields) if (!draftFields.has(field.field_key)) changes.push({ id: `field-:${field.field_key}`, title: `${q(field.label)} removed` });

  const savedSections = new Map(saved.form.sections.map((section) => [section.section_key, section]));
  const draftSections = new Map(draft.form.sections.map((section) => [section.section_key, section]));
  for (const section of draft.form.sections) {
    const before = savedSections.get(section.section_key);
    if (!before) changes.push({ id: `section+:${section.section_key}`, title: `Section ${q(section.label)} added` });
    else if (before.label !== section.label) changes.push({ id: `section-label:${section.section_key}`, title: `Section ${q(before.label)} renamed ${q(section.label)}` });
    const beforeFields = new Map((before?.fields ?? []).map((field) => [field.field_key, field]));
    const afterKeys = new Set(section.fields.map((field) => field.field_key));
    for (const placed of section.fields) {
      const was = beforeFields.get(placed.field_key);
      const label = labelOf(placed.field_key);
      if (!was) {
        // A brand-new field's own "added" line already says it; its placement is the same change.
        if (savedFields.has(placed.field_key)) changes.push({ id: `place:${section.section_key}:${placed.field_key}`, title: `${q(label)} added to ${q(section.label)}` });
        continue;
      }
      if (was.is_required !== placed.is_required)
        changes.push({ id: `form-required:${section.section_key}:${placed.field_key}`, title: `${q(label)} ${placed.is_required ? "required" : "optional"} on the form`, sub: `Was ${was.is_required ? "required" : "optional"}` });
      const a = condition(was);
      const b = condition(placed);
      if ((a?.field_key ?? "") !== (b?.field_key ?? "") || (a?.equals ?? "") !== (b?.equals ?? ""))
        changes.push({ id: `when:${section.section_key}:${placed.field_key}`, title: b ? `${q(label)} shows only when ${q(labelOf(b.field_key))} is ${q(b.equals)}` : `${q(label)} always shows` });
    }
    for (const was of before?.fields ?? []) {
      if (afterKeys.has(was.field_key) || !draftFields.has(was.field_key)) continue;
      changes.push({ id: `unplace:${section.section_key}:${was.field_key}`, title: `${q(labelOf(was.field_key))} removed from ${q(section.label)}` });
    }
    if (before) {
      const common = (list: TemplateFormField[], other: Set<string>) => list.map((field) => field.field_key).filter((key) => other.has(key)).join(",");
      const beforeKeys = new Set(before.fields.map((field) => field.field_key));
      if (common(before.fields, afterKeys) !== common(section.fields, beforeKeys)) changes.push({ id: `order:${section.section_key}`, title: `Fields in ${q(section.label)} reordered` });
    }
  }
  for (const section of saved.form.sections) if (!draftSections.has(section.section_key)) changes.push({ id: `section-:${section.section_key}`, title: `Section ${q(section.label)} removed` });
  const sectionOrder = (form: TemplateFormDefinition, other: Map<string, unknown>) => form.sections.map((section) => section.section_key).filter((key) => other.has(key)).join(",");
  if (sectionOrder(saved.form, draftSections) !== sectionOrder(draft.form, savedSections)) changes.push({ id: "section-order", title: "Sections reordered" });
  // LA-1.4-3: the six section-group switches.
  const savedAvailability = sectionAvailability(saved.form);
  const draftAvailability = sectionAvailability(draft.form);
  for (const group of TEMPLATE_SECTION_GROUPS)
    if (savedAvailability[group] !== draftAvailability[group])
      changes.push({ id: `availability:${group}`, title: `${TEMPLATE_SECTION_GROUP_LABELS[group]} sections ${draftAvailability[group] ? "switched on" : "switched off"}`, sub: `Was ${savedAvailability[group] ? "on" : "off"}` });

  const savedStages = new Map(saved.stages.map((stage) => [stage.stage_key, stage]));
  const draftStages = new Map(draft.stages.map((stage) => [stage.stage_key, stage]));
  for (const stage of draft.stages) {
    const before = savedStages.get(stage.stage_key);
    if (!before) { changes.push({ id: `stage+:${stage.stage_key}`, title: `Stage ${q(stage.label)} added` }); continue; }
    if (before.label !== stage.label) changes.push({ id: `stage-label:${stage.stage_key}`, title: `Stage ${q(before.label)} renamed ${q(stage.label)}` });
    if (before.stage_type !== stage.stage_type)
      changes.push({ id: `stage-type:${stage.stage_key}`, title: `Stage ${q(stage.label)} is now ${TEMPLATE_STAGE_TYPE_LABELS[stage.stage_type]}`, sub: `Was ${TEMPLATE_STAGE_TYPE_LABELS[before.stage_type]}` });
    if (before.color.toLowerCase() !== stage.color.toLowerCase()) changes.push({ id: `stage-color:${stage.stage_key}`, title: `Stage ${q(stage.label)} colour ${before.color} → ${stage.color}` });
  }
  for (const stage of saved.stages) if (!draftStages.has(stage.stage_key)) changes.push({ id: `stage-:${stage.stage_key}`, title: `Stage ${q(stage.label)} removed` });

  return changes;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "Commit all three", as the board says it; digits past ten. */
export function countWord(count: number) {
  return WORDS[count] ?? String(count);
}
