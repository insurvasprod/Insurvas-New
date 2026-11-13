// Settings r8, Application forms A9: what a draft changes, one plain line each, with its kind
// (Added / Changed / Moved / Removed) for the Versions tab and the Publish dialog. Built on
// diffTemplateDraft (lib/agentTemplates/draftChanges.ts) and extended with what format 2 adds:
// AND / OR logic, page skips, "no dates in the future" and the failure message. Client-safe.

import { diffTemplateDraft, type TemplateChange, type TemplateDraft } from "../agentTemplates/draftChanges.ts";
import { cleanLogic, logicSentence, placementLogic } from "./logic.ts";
import type { TemplateField, TemplateValidation } from "./constants.ts";

export type ChangeKind = "added" | "changed" | "moved" | "removed";
export type FormChange = TemplateChange & { kind: ChangeKind };

const FORMAT_2_RULES = ["no_future", "message"] as const;
const q = (text: string) => `“${text}”`;

function withoutFormat2Rules(draft: TemplateDraft): TemplateDraft {
  return {
    ...draft,
    fields: draft.fields.map((field) => {
      const validation = { ...(field.validation ?? {}) } as Record<string, unknown>;
      for (const key of FORMAT_2_RULES) delete validation[key];
      return { ...field, validation: validation as TemplateValidation };
    }),
  };
}

function kindOf(id: string): ChangeKind {
  if (/^(field\+|section\+|stage\+)/.test(id)) return "added";
  if (/^(field-:|section-:|stage-:|unplace:)/.test(id)) return "removed";
  if (/^(place:|order:|section-order)/.test(id)) return "moved";
  return "changed";
}

const pageWords = (title: string) => title.replace(/^Section /, "Page ").replace(/^Sections reordered$/, "Pages reordered").replace(/^Fields in /, "Questions on ");

export function formChanges(saved: TemplateDraft, draft: TemplateDraft): FormChange[] {
  const base = diffTemplateDraft(withoutFormat2Rules(saved), withoutFormat2Rules(draft))
    // The logic lines below replace the format-1 "shows only when" lines, so one change is one line.
    .filter((change) => !change.id.startsWith("when:"))
    .map((change) => ({ ...change, title: pageWords(change.title), kind: kindOf(change.id) }));

  const labels = new Map<string, string>([...saved.fields, ...draft.fields].map((field) => [field.field_key, field.label]));
  const labelOf = (key: string) => labels.get(key) ?? key;
  const out: FormChange[] = [...base];

  const savedPlacements = new Map(saved.form.sections.flatMap((section) => section.fields.map((field) => [`${section.section_key}:${field.field_key}`, field] as const)));
  for (const section of draft.form.sections) {
    for (const placed of section.fields) {
      const was = savedPlacements.get(`${section.section_key}:${placed.field_key}`);
      if (!was) continue;
      const before = logicSentence(placementLogic(was), labelOf);
      const after = logicSentence(placementLogic(placed), labelOf);
      if (before !== after) out.push({ id: `logic:${section.section_key}:${placed.field_key}`, kind: "changed", title: after ? `${q(labelOf(placed.field_key))} shows when ${after}` : `${q(labelOf(placed.field_key))} always shows`, sub: before ? `Was: when ${before}` : undefined });
    }
  }
  const savedSections = new Map(saved.form.sections.map((section) => [section.section_key, section]));
  for (const section of draft.form.sections) {
    const was = savedSections.get(section.section_key);
    const before = logicSentence(cleanLogic(was?.skip_when), labelOf);
    const after = logicSentence(cleanLogic(section.skip_when), labelOf);
    if (before !== after) out.push({ id: `skip:${section.section_key}`, kind: "changed", title: after ? `Page ${q(section.label)} is skipped when ${after}` : `Page ${q(section.label)} is never skipped` });
  }
  const savedFields = new Map<string, TemplateField>(saved.fields.map((field) => [field.field_key, field]));
  for (const field of draft.fields) {
    const was = savedFields.get(field.field_key);
    if (!was) continue;
    if (Boolean(was.validation?.no_future) !== Boolean(field.validation?.no_future)) out.push({ id: `nofuture:${field.field_key}`, kind: "changed", title: `${q(field.label)} ${field.validation?.no_future ? "no longer takes" : "takes"} dates in the future` });
    if ((was.validation?.message ?? "") !== (field.validation?.message ?? "")) out.push({ id: `message:${field.field_key}`, kind: "changed", title: `${q(field.label)} has a new message when it fails`, sub: field.validation?.message || "Back to the usual message" });
  }
  return out;
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = { added: "Added", changed: "Changed", moved: "Moved", removed: "Removed" };
