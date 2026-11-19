/**
 * SSN and bank numbers on an agent lead, as the agent screens read them (security review 2026-11, H-1).
 *
 * A lead template can carry `ssn`, `bank_routing` and `bank_account` fields, and before an application
 * holds its encrypted copy those values sit on `agent_leads.values` in plain text. The lead APIs used
 * to return that object whole, so every producer and assistant on the board received full SSNs and
 * bank numbers without the 2FA step-up, the typed reason or the access log that the reveal routes
 * require. Here the values leave the server masked to their last four ("•••• 4021"), the same form
 * the verification panel shows (lib/verification/sensitive.ts).
 *
 * What counts as sensitive is the union of two rules:
 * - the field's template type (`ssn`, `bank_routing`, `bank_account`), which is what the form itself
 *   says, whatever the field happens to be called;
 * - the key-name rule shared with the partner portal and the verification panel
 *   (SENSITIVE_PARTNER_KEY), so a field masked there is masked here too.
 *
 * Masked values travel back: the lead page sends the whole values object when it changes the stage.
 * `restoreMaskedLeadValues` puts the stored value back wherever the browser returned the mask, so a
 * save never overwrites a real SSN with "•••• 4021".
 *
 * Plain module (no `server-only`) so the rules are unit-tested (sensitive.test.mjs).
 */
import { isSensitiveFieldKey, maskLastFour } from "../verification/sensitive.ts";

export const SENSITIVE_LEAD_FIELD_TYPES: ReadonlySet<string> = new Set(["ssn", "bank_routing", "bank_account"]);

type FieldLike = { field_key: string; type?: string | null };
type Values = Record<string, unknown>;

function isRecord(value: unknown): value is Values {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The keys of a template that hold sensitive values, by type or by name. */
export function sensitiveLeadFieldKeys(fields: readonly FieldLike[] = []): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    if ((field.type && SENSITIVE_LEAD_FIELD_TYPES.has(field.type)) || isSensitiveFieldKey(field.field_key)) keys.add(field.field_key);
  }
  return keys;
}

/** Whether one key of a lead's values is sensitive, given the template's sensitive keys. */
export function isSensitiveLeadKey(key: string, typedKeys: ReadonlySet<string>): boolean {
  return typedKeys.has(key) || isSensitiveFieldKey(key);
}

/**
 * The values with every sensitive one replaced by its last-four mask. Empty values stay empty, and
 * everything else is returned unchanged. Not-an-object input comes back as an empty object.
 */
export function maskLeadValues(values: unknown, fields: readonly FieldLike[] = []): Values {
  if (!isRecord(values)) return {};
  const typed = sensitiveLeadFieldKeys(fields);
  let masked: Values | null = null;
  for (const [key, value] of Object.entries(values)) {
    if (!isSensitiveLeadKey(key, typed)) continue;
    if (value === null || value === undefined || value === "") continue;
    masked ??= { ...values };
    masked[key] = maskLastFour(value);
  }
  return masked ?? values;
}

/** One value under `key`, masked when the key is sensitive (verification rows, correction history). */
export function maskLeadFieldValue(key: string, value: unknown, typedKeys: ReadonlySet<string>): unknown {
  if (!isSensitiveLeadKey(key, typedKeys)) return value;
  if (value === null || value === undefined || value === "") return value;
  return maskLastFour(value);
}

/** The lead with its values masked; every other column is untouched. */
export function maskLead<L extends { values?: unknown }>(lead: L, fields: readonly FieldLike[] = []): L & { values: Values } {
  return { ...lead, values: maskLeadValues(lead.values, fields) };
}

/** Whether a value is a mask this app hands out ("•••• 4021", "••••", or the partner "[Masked]"). */
export function looksMasked(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  // A sealed value never reaches the browser; one sent in is treated like a mask, so a request cannot
  // plant another lead's ciphertext (lib/leadValues/seal.ts).
  return text === "[Masked]" || /^•{2,}(\s?\S{1,4})?$/.test(text) || text.startsWith("sealed1:");
}

/**
 * Incoming values with the stored value put back for every sensitive key the browser sent as a mask.
 * A sensitive key that comes back masked but has no stored value is cleared, never saved as the mask.
 * A real new value (anything not a mask) is kept, so a typed correction still saves.
 */
export function restoreMaskedLeadValues(incoming: unknown, stored: unknown, fields: readonly FieldLike[] = []): unknown {
  if (!isRecord(incoming)) return incoming;
  const before = isRecord(stored) ? stored : {};
  const typed = sensitiveLeadFieldKeys(fields);
  let restored: Values | null = null;
  for (const [key, value] of Object.entries(incoming)) {
    if (!isSensitiveLeadKey(key, typed) || !looksMasked(value)) continue;
    restored ??= { ...incoming };
    const kept = before[key];
    if (kept === undefined || kept === null || kept === "") delete restored[key];
    else restored[key] = kept;
  }
  return restored ?? incoming;
}
