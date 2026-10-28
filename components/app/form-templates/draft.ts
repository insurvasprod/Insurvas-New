// Settings › Form templates: the shapes the panel loads and the one draft it edits. Client-safe.
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";
import type { TemplateDraft } from "@/lib/agentTemplates/draftChanges";

export type Current = { tenant_template_id: string; assignment: { template_id: string; template_version: number; definition_version: number; product_code: string }; template: { name: string; description: string | null; product_name: string; version: number; definition_version: number; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition }; latest: { id: string; version: number; name: string } | null };
export type Available = { id: string; name: string; product_code: string; product_name: string; version: number; description: string | null };
export type Product = { code: string; name: string };
export type Preview = { fieldsToAdd: string[]; stagesToAdd: string[]; sectionsToAdd: string[]; alreadyApplied: boolean };
export type DraftState = { draft: TemplateDraft; seen: Record<string, number> };

export function cloneForm(form: TemplateFormDefinition): TemplateFormDefinition { return { sections: form.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, show_when: field.show_when ? { ...field.show_when } : null, conditional_on: field.conditional_on ? { ...field.conditional_on } : undefined })) })), ...(form.section_availability ? { section_availability: { ...form.section_availability } } : {}) }; }

export function draftFrom(current: Current): TemplateDraft {
  return {
    name: current.template.name,
    fields: current.template.fields.map((field) => ({ ...field, options: [...field.options], validation: { ...(field.validation ?? {}) } })),
    stages: current.template.stages.map((stage) => ({ ...stage })),
    form: cloneForm(current.template.form_definition),
  };
}

export function numberOrUndefined(value: string) { return value === "" ? undefined : Number(value); }

export function uniqueKey(base: string, used: Set<string>) {
  let index = used.size + 1;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}
