// Settings › Underwriting templates, round 2 (owner 2026-10-30): what the page says about its own
// templates. Pure and client-safe.
//
// - `inUseNow`: for each product line the agency sells, the template a new interview loads today,
//   worked out with the interview's own ladder (`pickTemplate`, lib/applications/templates.ts), so
//   the page and the call can never disagree. Carriers with a template of their own are listed too.
// - `templateChanges`: what a draft changes against the version it would replace (the publish
//   dialog and the save bar say it before anything goes live).

import { pickTemplate, type StoredDefinition } from "../applications/templates.ts";
import type { NamedCarrier, ProductLine, TemplateRowView } from "./views.ts";

/** Stands in for the agency's own tenant id: pickTemplate only compares it with each row's owner. */
const MINE = "agency";

type Choice = { id: string; version: number; tenant_id: string | null; carrier_id: string | null; product_code: string; row: TemplateRowView };

const choices = (all: readonly TemplateRowView[]): Choice[] =>
  all.filter((t) => t.status === "published").map((t) => ({ id: t.id, version: t.version, tenant_id: t.tenantOwned ? MINE : null, carrier_id: t.carrierId, product_code: t.productCode, row: t }));

export type CarrierUse = { carrierId: string; carrierName: string; template: TemplateRowView };

export type ProductUse = {
  productCode: string;
  productName: string;
  /** What a call for this product loads for any carrier without its own; null when nothing is published at all. */
  general: TemplateRowView | null;
  /** The general one is the Final Expense fallback, not one made for this product. */
  fallback: boolean;
  /** Carriers whose calls load a different template from `general`. */
  carriers: CarrierUse[];
};

/**
 * One entry per product line the agency sells (Settings › Products), in catalogue order, plus any
 * line the agency has a template for though it no longer sells it.
 */
export function inUseNow(all: readonly TemplateRowView[], productLines: readonly ProductLine[], carriers: readonly NamedCarrier[]): ProductUse[] {
  const list = choices(all);
  const owned = new Set(all.filter((t) => t.tenantOwned).map((t) => t.productCode));
  const lines = productLines.filter((p) => p.sold !== false || owned.has(p.code));
  return lines.map((p) => {
    const general = pickTemplate(list, { tenantId: MINE, carrierId: null, productCode: p.code })?.row ?? null;
    const own: CarrierUse[] = [];
    for (const c of carriers) {
      const hit = pickTemplate(list, { tenantId: MINE, carrierId: c.id, productCode: p.code })?.row ?? null;
      if (hit && hit.id !== general?.id) own.push({ carrierId: c.id, carrierName: c.name, template: hit });
    }
    return { productCode: p.code, productName: p.name, general, fallback: Boolean(general && general.productCode !== p.code), carriers: own };
  });
}

/** Which product lines and carriers load this template today ("Final Expense · every carrier"). */
export function usesOf(t: TemplateRowView, uses: readonly ProductUse[]): string[] {
  const out: string[] = [];
  for (const u of uses) {
    if (u.general?.id === t.id) out.push(u.carriers.length ? `${u.productName} · every other carrier` : `${u.productName} · every carrier`);
    for (const c of u.carriers) if (c.template.id === t.id) out.push(`${u.productName} · ${c.carrierName}`);
  }
  return out;
}

/** What the template was made for: "Final Expense · every carrier" or "Final Expense · only Americo". */
export function scopeOf(t: Pick<TemplateRowView, "productName" | "carrierName" | "carrierId">) {
  return t.carrierId ? `${t.productName} · only ${t.carrierName ?? "one carrier"}` : `${t.productName} · every carrier`;
}

// ── what a draft changes ─────────────────────────────────────────────────────

type Field = NonNullable<StoredDefinition["fields"]>[number];
type FormField = { field_key: string; is_required?: boolean; is_knockout?: boolean; knockout_note?: string | null; show_when?: unknown; applies_to?: string };

function flatten(def: StoredDefinition | null | undefined) {
  const fields = new Map((def?.fields ?? []).map((f) => [f.field_key, f]));
  const out = new Map<string, { field: Field; form: FormField; section: string; at: number }>();
  let at = 0;
  for (const s of def?.form_definition?.sections ?? []) {
    for (const raw of (s.fields ?? []) as FormField[]) {
      const field = fields.get(raw.field_key);
      if (field && !out.has(raw.field_key)) out.set(raw.field_key, { field, form: raw, section: s.label, at: at++ });
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type TemplateChanges = {
  added: string[];
  removed: string[];
  reworded: string[];
  /** Answer type, choices, required, help, section, who it is asked of, or the condition that opens it. */
  changed: string[];
  knockoutsAdded: string[];
  knockoutsRemoved: string[];
  /** The questions kept their content but moved. */
  reordered: boolean;
  /** Sections were added, removed or renamed. */
  sections: boolean;
  total: number;
};

/** What `to` changes against `from` (the live version, or the saved one), question by question. */
export function templateChanges(from: StoredDefinition | null | undefined, to: StoredDefinition | null | undefined): TemplateChanges {
  const a = flatten(from);
  const b = flatten(to);
  const label = (k: string) => b.get(k)?.field.label ?? a.get(k)?.field.label ?? k;
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const kept = [...b.keys()].filter((k) => a.has(k));
  const reworded = kept.filter((k) => a.get(k)!.field.label.trim() !== b.get(k)!.field.label.trim());
  const changed = kept.filter((k) => {
    const x = a.get(k)!;
    const y = b.get(k)!;
    return x.field.type !== y.field.type || !same(x.field.options, y.field.options) || (x.field.help_text ?? null) !== (y.field.help_text ?? null)
      || Boolean(x.form.is_required) !== Boolean(y.form.is_required) || x.section !== y.section || (x.form.applies_to ?? "all") !== (y.form.applies_to ?? "all")
      || !same(x.form.show_when, y.form.show_when) || (x.form.is_knockout && y.form.is_knockout && (x.form.knockout_note ?? "") !== (y.form.knockout_note ?? ""));
  });
  const ko = (m: typeof a, k: string) => Boolean(m.get(k)?.form.is_knockout);
  const knockoutsAdded = [...b.keys()].filter((k) => ko(b, k) && !ko(a, k));
  const knockoutsRemoved = [...a.keys()].filter((k) => ko(a, k) && !ko(b, k));
  const order = (m: typeof a) => [...m.entries()].filter(([k]) => a.has(k) && b.has(k)).sort((x, y) => x[1].at - y[1].at).map(([k]) => k).join("|");
  const reordered = order(a) !== order(b);
  const sectionNames = (d: StoredDefinition | null | undefined) => (d?.form_definition?.sections ?? []).map((s) => `${s.section_key}:${s.label}`).join("|");
  const sections = sectionNames(from) !== sectionNames(to);
  const n = (xs: string[]) => xs.map(label);
  return {
    added: n(added), removed: n(removed), reworded: n(reworded), changed: n(changed.filter((k) => !reworded.includes(k))),
    knockoutsAdded: n(knockoutsAdded), knockoutsRemoved: n(knockoutsRemoved), reordered, sections,
    total: added.length + removed.length + new Set([...reworded, ...changed]).size + knockoutsAdded.filter((k) => !added.includes(k)).length + knockoutsRemoved.filter((k) => !removed.includes(k)).length + (reordered ? 1 : 0) + (sections ? 1 : 0),
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "+2 questions · 1 knockout added · 1 reworded" — empty when nothing changed. */
export function changesSummary(c: TemplateChanges): string {
  const parts: string[] = [];
  if (c.added.length) parts.push(`+${count(c.added.length, "question")}`);
  if (c.removed.length) parts.push(`−${count(c.removed.length, "question")}`);
  if (c.knockoutsAdded.length) parts.push(`${count(c.knockoutsAdded.length, "knockout")} added`);
  if (c.knockoutsRemoved.length) parts.push(`${count(c.knockoutsRemoved.length, "knockout")} removed`);
  if (c.reworded.length) parts.push(`${c.reworded.length} reworded`);
  if (c.changed.length) parts.push(`${count(c.changed.length, "question")} changed`);
  if (c.reordered) parts.push("new order");
  if (c.sections) parts.push("sections changed");
  return parts.join(" · ");
}

// ── round 3 (owner picks 2A, 3A, 5A + every step, 2026-10-30) ─────────────────

/**
 * The Insurvas default a new template for this product starts from ("Start from Insurvas's"): the
 * platform's own for the product, else its Final Expense one — the platform rungs of the ladder.
 */
export function insurvasStart(all: readonly TemplateRowView[], productCode: string): TemplateRowView | null {
  const platform = all.filter((t) => !t.tenantOwned);
  return pickTemplate(choices(platform), { tenantId: MINE, carrierId: null, productCode })?.row ?? null;
}

const TYPE_WORDS: Record<string, string> = {
  boolean: "Yes / No", single_select: "One choice", multi_select: "Several choices", date: "Date", number: "Number", currency: "Dollar amount",
  text: "Free text", long_text: "Long free text", medication_list: "Medication list",
};
const ASKED_OF: Record<string, string> = { all: "", age_50_plus: "ages 50 and over", age_under_50: "under 50", tobacco: "tobacco users" };

/** "Yes / No · required · knockout · ages 50 and over" — one question, in words. */
function describe(x: { field: Field; form: FormField } | undefined): string {
  if (!x) return "—";
  return [TYPE_WORDS[x.field.type] ?? x.field.type, x.form.is_required ? "required" : "optional", x.form.is_knockout ? "knockout" : "", ASKED_OF[x.form.applies_to ?? "all"] ?? "", x.form.show_when ? "follow-up" : ""].filter(Boolean).join(" · ");
}

export type ChangeKind = "Added" | "Removed" | "Now a knockout" | "No longer a knockout" | "Reworded" | "Changed";
export type ChangeRow = { kind: ChangeKind; label: string; before: string; after: string };

/** One row per question that differs, with what it was and what it becomes (the review before publishing). */
export function changeRows(from: StoredDefinition | null | undefined, to: StoredDefinition | null | undefined): ChangeRow[] {
  const a = flatten(from);
  const b = flatten(to);
  const out: ChangeRow[] = [];
  for (const [k, y] of b) {
    const x = a.get(k);
    if (!x) { out.push({ kind: "Added", label: y.field.label, before: "—", after: describe(y) }); continue; }
    const before = describe(x);
    const after = describe(y);
    if (!x.form.is_knockout && y.form.is_knockout) out.push({ kind: "Now a knockout", label: y.field.label, before, after });
    else if (x.form.is_knockout && !y.form.is_knockout) out.push({ kind: "No longer a knockout", label: y.field.label, before, after });
    else if (x.field.label.trim() !== y.field.label.trim()) out.push({ kind: "Reworded", label: y.field.label, before: x.field.label, after: y.field.label });
    else if (before !== after || !same(x.field.options, y.field.options) || (x.field.help_text ?? null) !== (y.field.help_text ?? null) || x.section !== y.section || !same(x.form.show_when, y.form.show_when) || (x.form.knockout_note ?? "") !== (y.form.knockout_note ?? "")) {
      out.push({ kind: "Changed", label: y.field.label, before: x.section !== y.section ? `${before} · in ${x.section}` : before, after: x.section !== y.section ? `${after} · in ${y.section}` : after });
    }
  }
  for (const [k, x] of a) if (!b.has(k)) out.push({ kind: "Removed", label: x.field.label, before: describe(x), after: "—" });
  return out;
}
