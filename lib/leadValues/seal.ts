/**
 * SSN and bank numbers on an agent lead, encrypted at rest (security review 2026-11, H-1 steps 2–3;
 * Notion LA-3.7: "encrypted at rest with a per-tenant key, decrypted only on explicit read … masked by
 * default").
 *
 * ## Where the ciphertext lives
 *
 * In `agent_leads.values` itself, under the field's own key, as one sealed string:
 *
 *     sealed1:<last four>:<lookup>:<ciphertext>
 *
 * - `last four` is what every masked screen shows ("•••• 4021"), so masking needs no key.
 * - `lookup` is a keyed HMAC of an SSN's digits (see `ssnLookup`), so the partner duplicate check can
 *   still ask "is this SSN already submitted" without anyone reading the number back. "-" for bank
 *   values, which nothing looks up.
 * - `ciphertext` is lib/applications/cryptoCore.ts's AES-256-GCM `a1.<iv>.<tag>.<body>`, under the
 *   same per-tenant key (HKDF over APPLICATION_DATA_ENCRYPTION_KEY, tenant id as salt), with the
 *   associated data `<tenant>|agent_lead|<field key>`. A sealed value moved into another tenant or
 *   under another key fails to open rather than reading as somebody else's number. It is not bound to
 *   one lead: imports insert many leads in one SQL call, before any lead id exists.
 *
 * Kept in `values` rather than a side table so every existing reader keeps working (they treat the
 * value as text; the masks read its last four), the SQL writers need no change (TypeScript seals before
 * handing them the values), and no DDL is needed to store it.
 *
 * ## What is sealed
 *
 * A field typed `ssn`, `bank_routing` or `bank_account`, and any key named like an SSN, a routing or
 * account number, an IBAN or a card number. Narrower than the masking rule (which also hides policy
 * numbers and a bank's name): those are hidden on screen but stay readable to the server code that
 * matches policies.
 *
 * Plain module (no `server-only`) so tests and the backfill script can load it, as cryptoCore does. The
 * key only comes from the server environment, so a client bundle could seal or open nothing.
 */
import { createHmac, hkdfSync } from "node:crypto";

import { ApplicationKeyMissingError, decryptSensitive, encryptSensitive } from "../applications/cryptoCore.ts";

export const SEALED_PREFIX = "sealed1";
/** The application id slot of cryptoCore's associated data, for values that belong to a lead. */
const LEAD_SCOPE = "agent_lead";

const SEAL_FIELD_TYPES: ReadonlySet<string> = new Set(["ssn", "bank_routing", "bank_account"]);
const SEAL_KEY = /(ssn|social.?security|routing|account.?number|bank.?account|iban|credit.?card|card.?number)/i;
const SSN_KEY = /(ssn|social.?security)/i;

type FieldLike = { field_key: string; type?: string | null };
type Values = Record<string, unknown>;

function isRecord(value: unknown): value is Values {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The keys of a template that are sealed, by type or by name. */
export function sealedFieldKeys(fields: readonly FieldLike[] = []): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) if ((field.type && SEAL_FIELD_TYPES.has(field.type)) || SEAL_KEY.test(field.field_key)) keys.add(field.field_key);
  return keys;
}

export function shouldSealKey(key: string, typedKeys: ReadonlySet<string> = new Set()): boolean {
  return typedKeys.has(key) || SEAL_KEY.test(key);
}

export function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${SEALED_PREFIX}:`);
}

/** The last four characters a sealed value carries ("" for anything else). */
export function sealedLastFour(value: unknown): string {
  if (!isSealed(value)) return "";
  return value.split(":")[1] ?? "";
}

/** The lookup a sealed SSN carries ("" for none). */
export function sealedLookup(value: unknown): string {
  if (!isSealed(value)) return "";
  const lookup = value.split(":")[2] ?? "";
  return lookup === "-" ? "" : lookup;
}

/**
 * A value that must never be sealed as if it were a number: empty, a mask this app hands out
 * ("•••• 4021", "[Masked]"), or the "***-**-4021" that scrub_lead_ssn leaves once an application holds
 * the SSN. Sealing those would store a mask as though it were the real value.
 */
function isPlaceholder(text: string): boolean {
  return text === "" || text === "[Masked]" || /^[•*]/.test(text);
}

function digits(text: string) {
  return text.replace(/\D/g, "");
}

function lookupKey(tenantId: string): Buffer {
  const master = process.env.APPLICATION_DATA_ENCRYPTION_KEY;
  if (!master) throw new ApplicationKeyMissingError();
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.from(tenantId, "utf8"), Buffer.from("insurvas:lead-ssn-lookup:v1", "utf8"), 32));
}

/**
 * The keyed lookup of an SSN: HMAC-SHA256 of its nine digits under a per-tenant key derived from the
 * application data key. Equal SSNs in one tenant give equal lookups; without the key it reveals nothing,
 * and the same SSN in two tenants gives two different lookups. Null for anything that is not nine digits.
 */
export function ssnLookup(tenantId: string, value: unknown): string | null {
  const nine = digits(String(value ?? ""));
  if (nine.length !== 9) return null;
  return createHmac("sha256", lookupKey(tenantId)).update(nine, "utf8").digest("base64url");
}

/** One value sealed under `key`. A value already sealed, empty or a placeholder comes back as it was. */
export function sealLeadValue(tenantId: string, key: string, value: unknown): unknown {
  if (value === null || value === undefined || isSealed(value)) return value;
  if (typeof value !== "string" && typeof value !== "number") return value;
  const text = String(value).trim();
  if (isPlaceholder(text)) return value;
  const compact = text.replace(/\s+/g, "");
  const lastFour = compact.length > 4 ? compact.slice(-4) : "";
  const lookup = SSN_KEY.test(key) ? ssnLookup(tenantId, text) ?? "-" : "-";
  const { ciphertext } = encryptSensitive(text, { tenantId, applicationId: LEAD_SCOPE, fieldKey: key });
  return `${SEALED_PREFIX}:${lastFour}:${lookup}:${ciphertext}`;
}

/**
 * The plaintext of a sealed value; anything not sealed comes back unchanged (rows written before the
 * backfill, a scrubbed "***-**-4021"). A sealed value that does not open for this tenant and key gives
 * null — never the sealed text, so a caller cannot mistake it for the number.
 */
export function openLeadValue(tenantId: string, key: string, value: unknown): unknown {
  if (!isSealed(value)) return value;
  const ciphertext = value.split(":").slice(3).join(":");
  return decryptSensitive(ciphertext, null, { tenantId, applicationId: LEAD_SCOPE, fieldKey: key });
}

/** The values with every sensitive plaintext sealed. Throws ApplicationKeyMissingError only when there is something to seal. */
export function sealLeadValues(tenantId: string, values: unknown, fields: readonly FieldLike[] = []): Values {
  if (!isRecord(values)) return {};
  const typed = sealedFieldKeys(fields);
  let sealed: Values | null = null;
  for (const [key, value] of Object.entries(values)) {
    if (!shouldSealKey(key, typed)) continue;
    const next = sealLeadValue(tenantId, key, value);
    if (next === value) continue;
    sealed ??= { ...values };
    sealed[key] = next;
  }
  return sealed ?? values;
}

/** The values with every sealed value opened, for server code that needs the number (the application prefill). */
export function openLeadValues(tenantId: string, values: unknown): Values {
  if (!isRecord(values)) return {};
  let opened: Values | null = null;
  for (const [key, value] of Object.entries(values)) {
    if (!isSealed(value)) continue;
    opened ??= { ...values };
    const plain = openLeadValue(tenantId, key, value);
    if (plain === null) delete opened[key];
    else opened[key] = plain;
  }
  return opened ?? values;
}

/** Whether any value still holds a sensitive plaintext (the backfill's question). */
export function hasUnsealedSensitive(values: unknown, fields: readonly FieldLike[] = []): boolean {
  if (!isRecord(values)) return false;
  const typed = sealedFieldKeys(fields);
  return Object.entries(values).some(([key, value]) => {
    if (!shouldSealKey(key, typed) || value === null || value === undefined || isSealed(value)) return false;
    if (typeof value !== "string" && typeof value !== "number") return false;
    return !isPlaceholder(String(value).trim());
  });
}
