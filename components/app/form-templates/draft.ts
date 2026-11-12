// Settings › Application forms: the shapes the builder loads and the one draft it edits. Client-safe.
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";
import type { TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import { mergeFieldRules } from "@/lib/templates/fieldRulesStore";

export type Current = { tenant_template_id: string; assignment: { template_id: string; template_version: number; definition_version: number; product_code: string }; template: { name: string; description: string | null; product_name: string; version: number; definition_version: number; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition }; latest: { id: string; version: number; name: string } | null };
export type Available = { id: string; name: string; product_code: string; product_name: string; version: number; description: string | null };
export type Product = { code: string; name: string };
export type Preview = { fieldsToAdd: string[]; stagesToAdd: string[]; sectionsToAdd: string[]; alreadyApplied: boolean };
/** Who put the live version out, and when (GET /api/app/templates `published`). */
export type Published = { at: string; by: string | null };
export type DraftState = { draft: TemplateDraft; seen: Record<string, number> };
/** What GET /api/app/templates/forms says can save (lib/templates/formsServer.ts). */
export type Capabilities = { drafts: boolean; variants: boolean; share: boolean; webhooks: boolean; events: boolean; testLeads: boolean };
export const NO_CAPABILITIES: Capabilities = { drafts: false, variants: false, share: false, webhooks: false, events: false, testLeads: false };

export function cloneForm(form: TemplateFormDefinition): TemplateFormDefinition {
  // A structured copy: format-2 logic nests, and the builder must never edit the saved form in place.
  return JSON.parse(JSON.stringify(form)) as TemplateFormDefinition;
}

export function draftFrom(current: Current): TemplateDraft {
  const form = cloneForm(current.template.form_definition);
  return {
    name: current.template.name,
    fields: mergeFieldRules(current.template.fields.map((field) => ({ ...field, options: [...field.options], validation: { ...(field.validation ?? {}) } })), form),
    stages: current.template.stages.map((stage) => ({ ...stage })),
    form,
  };
}

export function numberOrUndefined(value: string) { return value === "" ? undefined : Number(value); }

export function uniqueKey(base: string, used: Set<string>) {
  let index = used.size + 1;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

/* ── the draft kept on this computer (a per-viewer convenience; Insurvas keeps it once 20261112200000 is live) ── */

const localKey = (copyId: string) => `insurvas.form-draft.${copyId}`;
export type LocalDraft = { base: number; draft: TemplateDraft; at: number };

export function readLocalDraft(copyId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(localKey(copyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft;
    return parsed && typeof parsed.base === "number" && parsed.draft && Array.isArray(parsed.draft.fields) ? parsed : null;
  } catch {
    return null;
  }
}
export function writeLocalDraft(copyId: string, value: LocalDraft | null) {
  try {
    if (value) window.localStorage.setItem(localKey(copyId), JSON.stringify(value));
    else window.localStorage.removeItem(localKey(copyId));
  } catch {
    // Private windows and full storage: the draft still lives in the page.
  }
}
