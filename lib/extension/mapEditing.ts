// Client-safe helpers the two field-map editors share (Settings › Sales and the staff console):
// canonical field labels, sensible defaults for a newly added field, and the save payload.

import { CANONICAL_GROUPS, isSensitiveKey, PAYMENT_FIELD_KEYS, type FieldInput } from "@/lib/applications/constants";
import type { FieldMapInputKind } from "./constants";
import type { FieldMapEntryView, FieldMapView } from "./types";

export const PAYMENT_LABEL: Record<(typeof PAYMENT_FIELD_KEYS)[number], string> = {
  "pay.method": "Payment method", "pay.routing_number": "Routing number", "pay.account_number": "Account number",
  "pay.account_type": "Account type", "pay.bank_name": "Bank name", "pay.name_on_account": "Name on account",
  "pay.card_number": "Card number", "pay.card_exp": "Card expiry", "pay.card_brand": "Card brand",
  "pay.name_on_card": "Name on card", "pay.billing_frequency": "Billing frequency", "pay.draft_day": "Draft day",
};

export type CanonicalOption = { key: string; label: string; group: string; input: FieldInput | "payment" };
export const CANONICAL_OPTIONS: CanonicalOption[] = [
  ...CANONICAL_GROUPS.flatMap((group) => group.fields.map((field) => ({ key: field.key, label: field.label, group: group.label, input: field.input }))),
  ...PAYMENT_FIELD_KEYS.map((key) => ({ key, label: PAYMENT_LABEL[key], group: "Payment", input: "payment" as const })),
];
const BY_KEY = new Map(CANONICAL_OPTIONS.map((option) => [option.key, option]));
export const fieldLabel = (key: string) => BY_KEY.get(key)?.label ?? key;

export const INPUT_KIND_LABEL: Record<FieldMapInputKind, string> = { text: "Text", date: "Date", select: "Select", radio: "Radio", masked: "Masked", checkbox: "Checkbox" };
export const PAGE_LABEL: Record<string, string> = { applicant: "Applicant", health: "Health", coverage: "Coverage", payment: "Payment" };

const HEALTH_KEYS = new Set(["insured.height_in", "insured.weight_lb", "insured.tobacco"]);
export function defaultPage(key: string) {
  if (HEALTH_KEYS.has(key)) return "health";
  if (key.startsWith("cov.")) return "coverage";
  if (key.startsWith("pay.")) return "payment";
  return "applicant";
}
export function defaultInputKind(key: string): FieldMapInputKind {
  if (isSensitiveKey(key)) return "masked";
  const input = BY_KEY.get(key)?.input;
  if (input === "date") return "date";
  if (input === "select" || input === "state" || input === "boolean") return "select";
  return "text";
}

export function newEntry(key: string): FieldMapEntryView {
  return { id: `new-${key}-${Date.now()}`, pageKey: defaultPage(key), fieldKey: key, selector: "", selectorFallback: null, inputKind: defaultInputKind(key), transform: null, optionMap: null, confidence: null, verified: false };
}

export const unverifiedSensitive = (entries: FieldMapEntryView[]) => entries.filter((e) => isSensitiveKey(e.fieldKey) && !e.verified).map((e) => e.fieldKey);

/** "A, B and C" */
export function listOf(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The PUT body for /field-maps/[id]. */
export function savePayload(map: Pick<FieldMapView, "steps">, entries: FieldMapEntryView[]) {
  return {
    steps: map.steps.map((s) => ({ page_key: s.pageKey, url_pattern: s.urlPattern, sort_order: s.sortOrder })),
    entries: entries.map((e) => ({
      page_key: e.pageKey, field_key: e.fieldKey, selector: e.selector, selector_fallback: e.selectorFallback, input_kind: e.inputKind,
      value_transform: e.transform, option_map: e.optionMap, verified: e.verified,
    })),
  };
}

/** A request to the field-map API; throws the server's own sentence on failure. */
export async function mapRequest(url: string, init: RequestInit = {}): Promise<FieldMapView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
  return data.map as FieldMapView;
}
