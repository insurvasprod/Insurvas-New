// Form templates, layout A (2026-10-30): what stops the draft being published, said before Publish is
// pressed. The server still checks everything (validateCopy, the RPC); these are the ones a person can
// fix on the page, worded as the page words them. Client-safe.
import type { TemplateField, TemplateFormDefinition } from "./constants.ts";
import { sectionAvailabilityError } from "./sectionAvailability.ts";
import { cleanLogic, formLogicProblem, logicReferences } from "./logic.ts";

/**
 * Server intake (normalizeFormValues in lib/agentTemplates/service.ts) still reads only the format-1
 * `show_when`. Until it reads format-2 logic through templateFormFieldVisible, a question that must be
 * answered cannot be hidden by AND / OR logic or a page skip: intake would ask for an answer the
 * person never saw. Flip this once that one-line change ships.
 */
export const SERVER_INTAKE_READS_FORMAT_2 = false;

export function publishBlockers(form: TemplateFormDefinition, fields: TemplateField[]): string[] {
  const out: string[] = [];
  const topic = sectionAvailabilityError(form, fields);
  if (topic) out.push(topic);
  const unnamed = fields.filter((field) => !field.label.trim()).length;
  if (unnamed) out.push(unnamed === 1 ? "A question has no words. Partners would see an empty label." : `${unnamed} questions have no words. Partners would see empty labels.`);
  if (form.sections.some((section) => !section.label.trim())) out.push("A page of the form has no name.");
  const noChoices = fields.find((field) => (field.type === "single_select" || field.type === "multi_select") && !field.options.some((option) => option.trim()));
  if (noChoices) out.push(`“${noChoices.label || "A question"}” has no choices to pick from.`);
  const logic = formLogicProblem(form);
  if (logic) out.push(logic);
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  for (const section of form.sections) {
    const skip = cleanLogic(section.skip_when);
    if (skip && logicReferences(skip).some((key) => section.fields.some((placed) => placed.field_key === key))) out.push(`Page “${section.label}” is skipped by a question on the same page, so it could never be answered.`);
    if (SERVER_INTAKE_READS_FORMAT_2) continue;
    for (const placed of section.fields) {
      const field = byKey.get(placed.field_key);
      const required = Boolean(field?.is_required || placed.is_required);
      if (!required) continue;
      if (cleanLogic(placed.logic)) out.push(`“${field?.label ?? placed.field_key}” must be answered but has more than one rule. Make it optional, or keep one rule, until Insurvas checks AND / OR rules when a form is sent.`);
      else if (skip) out.push(`“${field?.label ?? placed.field_key}” must be answered but its page can be skipped. Make it optional for now.`);
    }
  }
  return out;
}
