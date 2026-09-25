// The admin Templates catalog (board p-adm-templates): state, type, size, order and dependents.
// Plain module, no server-only: the server page and the client table share it.

import type { TemplateFormDefinition, TemplateRow } from "./constants";

/**
 * Published: tenants can pick it. Draft: never offered yet. Archived: offered once, then withdrawn.
 *
 * Draft and Archived are both `is_active = false`; `published_at` (migration 20260925504000) is what
 * tells them apart. Before that migration is applied there is no way to know, and no way to create
 * a draft either, so every inactive template reads as Archived — exactly what the page said before.
 */
export type TemplateState = "published" | "draft" | "archived";

export const TEMPLATE_STATES: readonly TemplateState[] = ["published", "draft", "archived"];

export const TEMPLATE_STATE_LABELS: Record<TemplateState, string> = {
  published: "Published",
  draft: "Draft",
  archived: "Archived",
};

export function templateState(isActive: boolean, publishedAt: string | null | undefined, draftsSupported: boolean): TemplateState {
  if (isActive) return "published";
  if (!draftsSupported) return "archived";
  return publishedAt ? "archived" : "draft";
}

/** Questions on the application form: every lead field placed in a section counts once per placement. */
export function formQuestionCount(form: TemplateFormDefinition): number {
  return form.sections.reduce((sum, section) => sum + section.fields.length, 0);
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The board's Type column. A platform template here is one versioned bundle — lead fields, a
 * pipeline and an application form move together — so the type says which parts it carries rather
 * than pretending each part is a separate template.
 */
export function templateTypeLabel(template: Pick<TemplateRow, "fields" | "stages" | "form_definition">): string {
  const parts: string[] = [];
  if (template.fields.length > 0) parts.push("Lead fields");
  if (template.stages.length > 0) parts.push("Pipeline");
  if (formQuestionCount(template.form_definition) > 0) parts.push("Application form");
  if (parts.length === 3) return "Full workspace";
  if (parts.length === 0) return "Empty";
  return parts.map((part, index) => (index === 0 ? part : part.toLowerCase())).join(" + ");
}

/** The Size column: "18 fields · 6 stages". */
export function templateSizeLabel(template: Pick<TemplateRow, "fields" | "stages">): string {
  return `${plural(template.fields.length, "field")} · ${plural(template.stages.length, "stage")}`;
}

/** Hover text for Size: every count, including the form, in words. */
export function templateSizeDetail(template: Pick<TemplateRow, "fields" | "stages" | "form_definition">): string {
  const questions = formQuestionCount(template.form_definition);
  const sections = template.form_definition.sections.length;
  return `${plural(template.fields.length, "lead field")}, ${plural(template.stages.length, "pipeline stage")}, ${plural(questions, "application question")} in ${plural(sections, "section")}`;
}

/** The footer's order, said truthfully: product name, then template name, then newest first. */
export const TEMPLATE_CATALOG_ORDER = "grouped by product, then name";

export function sortTemplatesForCatalog<T extends Pick<TemplateRow, "product_name" | "name" | "updated_at">>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.product_name.localeCompare(b.product_name, "en") ||
      a.name.localeCompare(b.name, "en") ||
      b.updated_at.localeCompare(a.updated_at),
  );
}

/** The default filter hides archived templates — what the old "Show archived" toggle did. */
export const DEFAULT_VISIBLE_STATES: readonly TemplateState[] = ["published", "draft"];

export type TemplateCatalogFilter = {
  query: string;
  productCode: string | "all";
  states: readonly TemplateState[];
};

export function filterTemplates<T extends Pick<TemplateRow, "name" | "description" | "product_code" | "product_name">>(
  rows: readonly T[],
  stateOf: (row: T) => TemplateState,
  filter: TemplateCatalogFilter,
): T[] {
  const needle = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.productCode !== "all" && row.product_code !== filter.productCode) return false;
    if (!filter.states.includes(stateOf(row))) return false;
    if (!needle) return true;
    return [row.name, row.description ?? "", row.product_name, row.product_code].join(" ").toLowerCase().includes(needle);
  });
}

/** One filter is "on" when the state selection is anything but all three. */
export function activeFilterCount(filter: Pick<TemplateCatalogFilter, "states">): number {
  return TEMPLATE_STATES.every((state) => filter.states.includes(state)) ? 0 : 1;
}

/**
 * What still uses a lead field inside this template: form placements and show/hide conditions.
 * The editor refuses to remove a field while this is non-empty and names each dependent, which is
 * what the board's callout promises ("names its dependents before it is allowed").
 */
export function leadFieldDependents(
  fieldKey: string,
  form: TemplateFormDefinition,
  labelOf: (key: string) => string,
): string[] {
  const found: string[] = [];
  for (const section of form.sections) {
    for (const formField of section.fields) {
      if (formField.field_key === fieldKey) found.push(`the “${section.label}” form section`);
      const condition = formField.show_when ?? formField.conditional_on;
      if (condition && condition.field_key === fieldKey && formField.field_key !== fieldKey) {
        found.push(`the condition on “${labelOf(formField.field_key)}”`);
      }
    }
  }
  return [...new Set(found)];
}

/** Per-template reach, read from tenant copies and in-progress applications. */
export type TemplateUsage = {
  /** Agencies holding a copy of this template (any version). */
  agencies: number;
  /** Of those, how many copied an earlier platform version than the current one. */
  agenciesOnEarlierVersion: number;
  /** Applications in progress on those copies (saved form drafts). */
  inProgress: number;
  /** Of those, how many were started on an earlier revision of the agency's copy. */
  inProgressOnEarlierVersion: number;
};

export const EMPTY_TEMPLATE_USAGE: TemplateUsage = { agencies: 0, agenciesOnEarlierVersion: 0, inProgress: 0, inProgressOnEarlierVersion: 0 };

export type TemplateUsageSummary = {
  byTemplate: Record<string, TemplateUsage>;
  inProgress: number;
  inProgressOnEarlierVersion: number;
};

/** Pure roll-up so the counting rule is testable without a database. */
export function summarizeTemplateUsage(
  templates: readonly Pick<TemplateRow, "id" | "version">[],
  copies: readonly { id: string; template_id: string; template_version: number; definition_version: number }[],
  drafts: readonly { tenant_template_id: string; definition_version: number }[],
): TemplateUsageSummary {
  const currentVersion = new Map(templates.map((template) => [template.id, template.version]));
  const copyById = new Map(copies.map((copy) => [copy.id, copy]));
  const byTemplate: Record<string, TemplateUsage> = {};
  const entry = (id: string) => (byTemplate[id] ??= { ...EMPTY_TEMPLATE_USAGE });

  for (const copy of copies) {
    const usage = entry(copy.template_id);
    usage.agencies += 1;
    const current = currentVersion.get(copy.template_id);
    if (current !== undefined && copy.template_version < current) usage.agenciesOnEarlierVersion += 1;
  }

  let inProgress = 0;
  let inProgressOnEarlierVersion = 0;
  for (const draft of drafts) {
    inProgress += 1;
    const copy = copyById.get(draft.tenant_template_id);
    const earlier = copy !== undefined && draft.definition_version < copy.definition_version;
    if (earlier) inProgressOnEarlierVersion += 1;
    if (copy) {
      const usage = entry(copy.template_id);
      usage.inProgress += 1;
      if (earlier) usage.inProgressOnEarlierVersion += 1;
    }
  }
  return { byTemplate, inProgress, inProgressOnEarlierVersion };
}
