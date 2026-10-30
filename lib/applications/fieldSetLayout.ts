// LA-3.7 · what an application's field set tells the application step beyond `required` (owner
// 2026-10-30): which built-in fields are asked and in what order, the carrier's wording and help line
// for each, and the agency's own questions. Client-safe and pure.

import { fieldSetEntries } from "../salesSettings/templateDefinition.ts";
import type { StoredDefinition } from "./templates.ts";

export type CustomQuestionView = { key: string; label: string; type: string; options: string[]; help: string; required: boolean; group: string };

export type FieldSetLayout = {
  /** Every asked key, built-in and the agency's own, in the agent's order. */
  order: string[];
  /** The carrier's wording for a built-in field, where the set gives one. */
  wording: Record<string, string>;
  help: Record<string, string>;
  custom: CustomQuestionView[];
};

export function fieldSetLayout(def: StoredDefinition | null | undefined): FieldSetLayout | null {
  if (!def) return null;
  const entries = fieldSetEntries(def);
  if (!entries.length) return null;
  const wording: Record<string, string> = {};
  const help: Record<string, string> = {};
  for (const e of entries) {
    if (!e.custom && e.label !== e.canonicalLabel) wording[e.key] = e.label;
    if (e.help) help[e.key] = e.help;
  }
  return {
    order: entries.map((e) => e.key),
    wording,
    help,
    custom: entries.filter((e) => e.custom).map((e) => ({ key: e.key, label: e.label, type: e.custom!.type, options: e.custom!.options, help: e.help, required: e.required, group: e.group })),
  };
}

/**
 * The keys of one section in the set's order: the asked ones the set names, then (when the set says
 * nothing about the section) every key in its built-in order. Not-asked fields are left out.
 */
export function orderedKeys(layout: FieldSetLayout | null | undefined, keys: readonly string[]): string[] {
  if (!layout) return [...keys];
  const asked = layout.order.filter((k) => keys.includes(k));
  return asked.length ? asked : [...keys];
}
