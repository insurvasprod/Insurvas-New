// The bulk payload the extension reads (LA-3.12, 3.13, 3.14). Pure, so the rule that matters most
// is testable without a database: the SSN, routing, account and card numbers are NEVER in it. They
// are fetched one field per request through /api/app/extension/fields/[key], each one logged.
//
// The payload is built from pieces the server already holds (the copy-assist groups, the raw
// canonical values, the published map), and every piece passes through `withoutSensitive` on its
// way out — a sensitive value that somehow reached the inputs is dropped, not sent.

import { isSensitiveKey, SENSITIVE_FIELD_KEYS } from "../applications/constants.ts";
import type { FieldMapInputKind } from "./constants.ts";
import { applyTransform } from "./transforms.ts";

export type BulkItem = { key: string; label: string; name: string; display: string | null; copy: string | null; variants?: { label: string; value: string }[]; section?: string };
export type BulkGroup = { key: string; label: string; items: BulkItem[] };
/** A sensitive field the extension may ask for, one at a time. The mask only — never the value. */
export type SensitiveRef = { key: string; label: string; group: string; masked: string };

export type FillEntry = {
  id: string;
  fieldKey: string;
  selector: string;
  selectorFallback: string | null;
  inputKind: FieldMapInputKind;
  /** The transformed value to put in the field; null when sensitive (fetched per field) or empty. */
  value: string | null;
  /** True for the SSN and bank / card numbers: the extension fetches the value by `id`. */
  sensitive: boolean;
};
export type FillStep = { id: string; pageKey: string; urlPattern: string; sortOrder: number; entries: FillEntry[] };
export type FillMap = { id: string; version: number; status: string; steps: FillStep[] };

export type BulkPayload = {
  application: { id: string; attemptNo: number; clientName: string; carrierName: string | null; productLabel: string | null };
  grant: { id: string; origin: string; expiresAt: string };
  groups: BulkGroup[];
  /** Raw canonical values (non-sensitive), keyed by canonical field key. */
  values: Record<string, string>;
  sensitive: SensitiveRef[];
  map: FillMap | null;
  ticks: string[];
};

/** Input shape: copy-assist groups whose items may carry a sensitive mask. */
export type CopyGroupInput = { key: string; label: string; items: (BulkItem & { sensitive?: { masked: string } })[] };

/**
 * Splits copy-assist groups into what may travel in bulk (plain items) and the refs of the
 * sensitive items (key, label, mask). A sensitive key never appears in `groups`.
 */
export function splitGroups(groups: CopyGroupInput[]): { groups: BulkGroup[]; sensitive: SensitiveRef[] } {
  const sensitive: SensitiveRef[] = [];
  const plain = groups.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.items.flatMap((item) => {
      if (isSensitiveKey(item.key) || item.sensitive) {
        if (isSensitiveKey(item.key) && item.sensitive) sensitive.push({ key: item.key, label: item.label, group: g.key, masked: item.sensitive.masked });
        return [];
      }
      const { key, label, name, display, copy, variants, section } = item;
      return [{ key, label, name, display, copy, ...(variants ? { variants } : {}), ...(section ? { section } : {}) }];
    }),
  }));
  return { groups: plain, sensitive };
}

/** Raw values with every sensitive key removed and everything else as a string. */
export function withoutSensitive(values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isSensitiveKey(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    out[key] = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  }
  return out;
}

export type MapInput = {
  id: string;
  version: number;
  status: string;
  steps: { id: string; page_key: string; url_pattern: string; sort_order: number }[];
  entries: { id: string; step_id: string; field_key: string; selector: string; selector_fallback: string | null; input_kind: FieldMapInputKind; value_transform: string | null; option_map: Record<string, string> | null }[];
};

/**
 * The published map with each entry's value already transformed, server-side — the extension has
 * no transform logic of its own. Sensitive entries carry `value: null`; the extension fetches them
 * one at a time, by entry, and the server transforms that one value too.
 */
export function fillMap(map: MapInput | null, values: Record<string, string>): FillMap | null {
  if (!map) return null;
  const steps = [...map.steps].sort((a, b) => a.sort_order - b.sort_order).map((step) => ({
    id: step.id,
    pageKey: step.page_key,
    urlPattern: step.url_pattern,
    sortOrder: step.sort_order,
    entries: map.entries.filter((e) => e.step_id === step.id).map((e): FillEntry => {
      const sensitive = isSensitiveKey(e.field_key);
      return {
        id: e.id,
        fieldKey: e.field_key,
        selector: e.selector,
        selectorFallback: e.selector_fallback,
        inputKind: e.input_kind,
        value: sensitive ? null : applyTransform(values[e.field_key], e.value_transform, e.option_map),
        sensitive,
      };
    }),
  }));
  return { id: map.id, version: map.version, status: map.status, steps };
}

export function buildBulkPayload(input: {
  application: BulkPayload["application"];
  grant: BulkPayload["grant"];
  groups: CopyGroupInput[];
  values: Record<string, unknown>;
  map: MapInput | null;
  ticks: string[];
}): BulkPayload {
  const { groups, sensitive } = splitGroups(input.groups);
  const values = withoutSensitive(input.values);
  const payload: BulkPayload = { application: input.application, grant: input.grant, groups, values, sensitive, map: fillMap(input.map, values), ticks: input.ticks };
  assertBulkSafe(payload);
  return payload;
}

/**
 * The last check before a bulk payload leaves: no sensitive key carries a value anywhere in it.
 * Throws rather than trimming — a payload that fails this is a bug upstream, not something to hide.
 */
export function assertBulkSafe(payload: BulkPayload) {
  const leaks: string[] = [];
  for (const key of Object.keys(payload.values)) if (isSensitiveKey(key)) leaks.push(`values.${key}`);
  for (const g of payload.groups) for (const item of g.items) if (isSensitiveKey(item.key)) leaks.push(`groups.${g.key}.${item.key}`);
  for (const step of payload.map?.steps ?? []) for (const e of step.entries) if (isSensitiveKey(e.fieldKey) && (e.value !== null || !e.sensitive)) leaks.push(`map.${step.pageKey}.${e.fieldKey}`);
  if (leaks.length) throw new Error(`Sensitive field in a bulk extension payload: ${leaks.join(", ")}`);
}

export { SENSITIVE_FIELD_KEYS };
