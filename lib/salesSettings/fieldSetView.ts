// LA-3.7 · Settings › Application field sets (owner pick B, 2026-10-30). The editor shows every field
// an application can carry, each Not asked / Optional / Required, instead of a hidden "add a field"
// list; these are the pure steps behind it. Client-safe. The stored shape is
// {required, optional, labels, order, help, custom} (fieldSetDefinitionSchema); the entry list's own
// order is the order the agent sees (owner 2026-10-30: questions move, and the agency adds its own).

import { CANONICAL_GROUPS, PAYMENT_FIELD_KEYS, isSensitiveKey } from "../applications/constants.ts";
import { CUSTOM_TYPE_LABEL, fieldMeta, groupOfKey, type FieldSetEntry } from "./templateDefinition.ts";
import { FIELD_SET_KEYS } from "./templateSchemas.ts";

export type FieldState = "off" | "optional" | "required";

export const FIELD_STATE_LABEL: Record<FieldState, string> = { off: "Not asked", optional: "Optional", required: "Required" };

/** The editor's sections: the canonical groups, then the typed payment keys. */
export const FIELD_SET_GROUPS: readonly { key: string; label: string; keys: readonly string[] }[] = [
  ...CANONICAL_GROUPS.map((g) => ({ key: g.key, label: g.label, keys: g.fields.map((f) => f.key) })),
  { key: "pay", label: "Payment", keys: [...PAYMENT_FIELD_KEYS] },
];

export function stateOfKey(entries: readonly FieldSetEntry[], key: string): FieldState {
  const e = entries.find((x) => x.key === key);
  return !e ? "off" : e.required ? "required" : "optional";
}

/** A built-in field as a new entry, before it has wording or help of its own. */
function builtIn(key: string, required: boolean): FieldSetEntry {
  const meta = fieldMeta(key);
  return { key, canonicalLabel: meta.label, label: meta.label, typeLabel: meta.type, required, sensitive: isSensitiveKey(key), help: "", group: groupOfKey(key), custom: null };
}

/** Puts a new entry at the end of its section (after the section's last asked field), else where its section starts. */
function insertInGroup(entries: readonly FieldSetEntry[], entry: FieldSetEntry): FieldSetEntry[] {
  const lastOfGroup = entries.map((e) => e.group).lastIndexOf(entry.group);
  if (lastOfGroup >= 0) return [...entries.slice(0, lastOfGroup + 1), entry, ...entries.slice(lastOfGroup + 1)];
  const sectionOrder = FIELD_SET_GROUPS.map((g) => g.key);
  const mine = sectionOrder.indexOf(entry.group);
  const after = entries.findIndex((e) => sectionOrder.indexOf(e.group) > mine);
  return after < 0 ? [...entries, entry] : [...entries.slice(0, after), entry, ...entries.slice(after)];
}

/** Sets one field's state. A field kept asked keeps its place, wording and help; a new one joins the end of its section. */
export function setKeyState(entries: readonly FieldSetEntry[], key: string, state: FieldState): FieldSetEntry[] {
  const had = entries.find((e) => e.key === key);
  if (state === "off") return entries.filter((e) => e.key !== key);
  if (had) return entries.map((e) => (e.key === key ? { ...e, required: state === "required" } : e));
  return insertInGroup(entries, builtIn(key, state === "required"));
}

/** "Require all asked" for one section: every asked field in it becomes required. */
export function requireAsked(entries: readonly FieldSetEntry[], keys: readonly string[]): FieldSetEntry[] {
  return entries.map((e) => (keys.includes(e.key) ? { ...e, required: true } : e));
}

/** The asked fields of one section, in the agent's order. */
export function groupEntries(entries: readonly FieldSetEntry[], group: string): FieldSetEntry[] {
  return entries.filter((e) => e.group === group);
}

/** Moves a field to `toIndex` among its own section's asked fields (drag, or a keyboard step). */
export function moveWithinGroup(entries: readonly FieldSetEntry[], key: string, toIndex: number): FieldSetEntry[] {
  const entry = entries.find((e) => e.key === key);
  if (!entry) return [...entries];
  const section = groupEntries(entries, entry.group).filter((e) => e.key !== key);
  const at = Math.max(0, Math.min(toIndex, section.length));
  const reordered = [...section.slice(0, at), entry, ...section.slice(at)];
  // The section's slots in the whole list stay where they were; only who fills them changes.
  let i = 0;
  return entries.map((e) => (e.group === entry.group ? reordered[i++] : e));
}

/** A key for a new question from its text: custom.<words>, unique within the set. */
export function customKeyFor(label: string, taken: readonly string[]) {
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "question";
  let key = `custom.${base.length >= 2 ? base : `q_${base}`}`;
  for (let n = 2; taken.includes(key); n++) key = `custom.${base.slice(0, 40)}_${n}`;
  return key;
}

export type QuestionDraft = { label: string; help: string; type: string; options: string[]; group: string; state: Exclude<FieldState, "off"> };

/** Adds an agency question at the end of its section. */
export function addCustom(entries: readonly FieldSetEntry[], q: QuestionDraft): FieldSetEntry[] {
  const key = customKeyFor(q.label, entries.map((e) => e.key));
  const label = q.label.trim();
  return insertInGroup(entries, {
    key, canonicalLabel: label, label, typeLabel: CUSTOM_TYPE_LABEL[q.type] ?? q.type, required: q.state === "required", sensitive: false, help: q.help.trim(), group: q.group,
    custom: { type: q.type, options: q.type === "choice" ? q.options.map((o) => o.trim()).filter(Boolean) : [] },
  });
}

/**
 * Edits one field. A built-in field changes only its wording and help: its key and type are what
 * autofill maps, copy-assist and QA rely on. An agency question changes everything, its section too.
 */
export function editEntry(entries: readonly FieldSetEntry[], key: string, q: Partial<QuestionDraft>): FieldSetEntry[] {
  const e = entries.find((x) => x.key === key);
  if (!e) return [...entries];
  const state = q.state ? { required: q.state === "required" } : {};
  if (!e.custom) {
    const label = q.label === undefined ? e.label : q.label.trim() || e.canonicalLabel;
    return entries.map((x) => (x.key === key ? { ...x, label, help: q.help === undefined ? x.help : q.help.trim(), ...state } : x));
  }
  const type = q.type ?? e.custom.type;
  const label = q.label === undefined ? e.label : q.label.trim() || e.label;
  const next: FieldSetEntry = {
    ...e, ...state, label, canonicalLabel: label, typeLabel: CUSTOM_TYPE_LABEL[type] ?? type, help: q.help === undefined ? e.help : q.help.trim(),
    custom: { type, options: type === "choice" ? (q.options ?? e.custom.options).map((o) => o.trim()).filter(Boolean) : [] },
  };
  if (q.group && q.group !== e.group) return insertInGroup(entries.filter((x) => x.key !== key), { ...next, group: q.group });
  return entries.map((x) => (x.key === key ? next : x));
}

export type FieldSetChange = { key: string; label: string; from: FieldState; to: FieldState; wording: string | null; added: boolean; moved: boolean; help: boolean };

/** How a set differs from another (the platform set): added questions, state, wording, help and position. */
export function changesFrom(base: readonly FieldSetEntry[], mine: readonly FieldSetEntry[]): FieldSetChange[] {
  const out: FieldSetChange[] = [];
  const keys = [...FIELD_SET_KEYS, ...mine.filter((e) => e.custom).map((e) => e.key)];
  // A field moved when the asked fields it shares a section with sit in another order around it.
  const rank = (list: readonly FieldSetEntry[], key: string, group: string, among: Set<string>) => groupEntries(list, group).filter((e) => among.has(e.key)).findIndex((e) => e.key === key);
  for (const key of keys) {
    const from = stateOfKey(base, key);
    const to = stateOfKey(mine, key);
    const own = mine.find((e) => e.key === key);
    const theirs = base.find((e) => e.key === key);
    const added = Boolean(own?.custom) && !theirs;
    const wording = own && !own.custom && own.label.trim() && own.label.trim() !== own.canonicalLabel ? own.label.trim() : null;
    const baseWording = theirs && !theirs.custom && theirs.label.trim() !== theirs.canonicalLabel ? theirs.label.trim() : null;
    const help = Boolean(own && own.help !== (theirs?.help ?? ""));
    let moved = false;
    if (own && theirs) {
      const both = new Set(groupEntries(mine, own.group).map((e) => e.key).filter((k) => base.some((b) => b.key === k)));
      moved = rank(mine, key, own.group, both) !== rank(base, key, own.group, both);
    }
    if (added || from !== to || (to !== "off" && wording !== baseWording) || help || moved) {
      out.push({ key, label: own?.label ?? fieldMeta(key).label, from, to, wording, added, moved, help });
    }
  }
  return out;
}

/**
 * The asked fields a carrier's autofill map does not place, so agents type them by hand. `mapKeys`
 * null means there is no map to fill from at all. An agency question is never on a carrier's map.
 */
export function unplacedKeys(entries: readonly FieldSetEntry[], mapKeys: ReadonlySet<string> | null): string[] | null {
  if (!mapKeys) return null;
  return entries.filter((e) => !e.custom && !mapKeys.has(e.key)).map((e) => e.key);
}
