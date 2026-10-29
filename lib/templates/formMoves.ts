// Form templates, variant C: reordering the form. Pure and client-safe; the settings page passes the
// result into its one draft. A move past either end returns the form unchanged.
import type { TemplateFormDefinition } from "./constants";

export function moveSection(form: TemplateFormDefinition, sectionKey: string, by: -1 | 1): TemplateFormDefinition {
  const index = form.sections.findIndex((section) => section.section_key === sectionKey);
  const target = index + by;
  if (index < 0 || target < 0 || target >= form.sections.length) return form;
  const sections = [...form.sections];
  [sections[index], sections[target]] = [sections[target], sections[index]];
  return { ...form, sections };
}

/** Within its own section only; moving a question to another section is a separate, explicit choice. */
export function moveFieldWithinSection(form: TemplateFormDefinition, sectionKey: string, fieldKey: string, by: -1 | 1): TemplateFormDefinition {
  let moved = false;
  const sections = form.sections.map((section) => {
    if (section.section_key !== sectionKey) return section;
    const index = section.fields.findIndex((field) => field.field_key === fieldKey);
    const target = index + by;
    if (index < 0 || target < 0 || target >= section.fields.length) return section;
    const fields = [...section.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    moved = true;
    return { ...section, fields };
  });
  return moved ? { ...form, sections } : form;
}

/** Whether the up and down buttons for a question can do anything. */
export function fieldMoveBounds(form: TemplateFormDefinition, sectionKey: string, fieldKey: string): { up: boolean; down: boolean } {
  const section = form.sections.find((item) => item.section_key === sectionKey);
  const index = section ? section.fields.findIndex((field) => field.field_key === fieldKey) : -1;
  if (!section || index < 0) return { up: false, down: false };
  return { up: index > 0, down: index < section.fields.length - 1 };
}
