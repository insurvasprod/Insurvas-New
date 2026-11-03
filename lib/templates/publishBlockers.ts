// Form templates, layout A (2026-10-30): what stops the draft being published, said before Publish is
// pressed. The server still checks everything (validateCopy, the RPC); these are the ones a person can
// fix on the page, worded as the page words them. Client-safe.
import type { TemplateField, TemplateFormDefinition } from "./constants.ts";
import { sectionAvailabilityError } from "./sectionAvailability.ts";

export function publishBlockers(form: TemplateFormDefinition, fields: TemplateField[]): string[] {
  const out: string[] = [];
  const topic = sectionAvailabilityError(form, fields);
  if (topic) out.push(topic);
  const unnamed = fields.filter((field) => !field.label.trim()).length;
  if (unnamed) out.push(unnamed === 1 ? "A question has no words. Partners would see an empty label." : `${unnamed} questions have no words. Partners would see empty labels.`);
  if (form.sections.some((section) => !section.label.trim())) out.push("A part of the form has no name.");
  const noChoices = fields.find((field) => (field.type === "single_select" || field.type === "multi_select") && !field.options.some((option) => option.trim()));
  if (noChoices) out.push(`“${noChoices.label || "A question"}” has no choices to pick from.`);
  return out;
}
