import { createHash, randomBytes } from "node:crypto";

import type { ApiScope } from "./constants.ts";

/**
 * LA-8.7 · the rules an API key lives by, pure so they are tested.
 *
 * The key is `isk_` and 43 base64url characters (32 random bytes). The database keeps its SHA-256 —
 * a fast hash is right for a high-entropy secret: there is nothing to brute-force — the first 12
 * characters to recognise it by, and the last four.
 */

export function generateApiKey(): { key: string; hash: string; prefix: string; lastFour: string } {
  const key = `isk_${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12), lastFour: key.slice(-4) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `Authorization: Bearer isk_…`; anything else is no key. */
export function bearerApiKey(header: string | null): string | null {
  const match = /^Bearer\s+(isk_[A-Za-z0-9_-]{20,100})\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/**
 * Every /api/v1 route and the one scope it needs. A route not listed here is not reachable with a
 * key: `authenticateApiKey` takes the route's name and finds its scope here, so a key for posting
 * leads gets 403 on commissions because commissions are not in its scopes — asserted per scope by
 * lib/apiKeys/apiKeys.test.mjs.
 */
export const API_ROUTES = {
  "POST /api/v1/leads": "leads:write",
  "GET /api/v1/leads": "leads:read",
  "GET /api/v1/policies": "policies:read",
  "GET /api/v1/commissions": "commissions:read",
  "GET /api/v1/webhooks": "webhooks:manage",
  "POST /api/v1/webhooks": "webhooks:manage",
  "DELETE /api/v1/webhooks/:id": "webhooks:manage",
} as const satisfies Record<string, ApiScope>;

export type ApiRoute = keyof typeof API_ROUTES;

/**
 * The plan feature behind each scope. A key reaches only what the agency's plan includes: the same
 * gate the screens use (requireFeature), so a key is never a way round an entitlement.
 */
export const API_SCOPE_FEATURE: Record<ApiScope, string | null> = {
  "leads:write": "lead_import",
  "leads:read": "book_of_business",
  "policies:read": "statement_ingestion",
  "commissions:read": "statement_ingestion",
  "webhooks:manage": null,
};

export function scopeAllows(route: ApiRoute, scopes: readonly string[]): boolean {
  return scopes.includes(API_ROUTES[route]);
}

export type KeyRecord = { revoked_at: string | null; expires_at: string | null; scopes: string[] };

export type KeyDecision = { ok: true } | { ok: false; status: 401 | 403; code: "invalid_key" | "insufficient_scope"; message: string };

/**
 * Decided from the stored row on every request — revocation and expiry are never inferred from the
 * key. "No such key", "revoked" and "expired" are one answer, so a caller cannot tell which.
 */
export function decideKey(row: KeyRecord | null, route: ApiRoute, now: number): KeyDecision {
  if (!row || row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= now)) {
    return { ok: false, status: 401, code: "invalid_key", message: "That API key is not valid." };
  }
  if (!scopeAllows(route, row.scopes)) {
    return { ok: false, status: 403, code: "insufficient_scope", message: `This key does not have the ${API_ROUTES[route]} scope.` };
  }
  return { ok: true };
}

/**
 * Field names that would carry an SSN, a bank account or a card. No API response and no webhook
 * payload may contain one, whatever the scope: those are per-field reveals behind a person's session
 * with an audit row (LA-3.7), and a key is not a person.
 */
// Matched on whole words of the key (camelCase and any separator become "_"), so a harmless name
// that merely contains a fragment — bank_descriptor, card_count, scorecard, japan, martin — passes.
const SENSITIVE_KEY = new RegExp(
  "(^|_)(" + [
    "ssn", "social_security(_number|_no)?", "tax_?id(_number)?", "taxpayer_id", "tin", "ein", "itin",
    "routing_(number|no|num)", "aba(_routing)?(_number)?",
    "(bank_)?account_(number|no|num)", "acct_(number|no|num)", "bank_account", "iban",
    "(credit_)?card_(number|no|num)", "credit_card", "cc_(number|num)", "cvv2?", "cvc", "pan", "primary_account_number",
    "dob_full",
  ].join("|") + ")(_|$)",
);

/** "routingNumber" → "routing_number", "Card-Number" → "card_number". */
const keyWords = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  // A key that is just "routing" holds a routing number; routing_rule, routing_mode do not.
  return words === "routing" || SENSITIVE_KEY.test(words);
}

/** The paths of every sensitive-looking key in a JSON value; empty when it is clean. */
export function findSensitiveKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSensitiveKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(isSensitiveKey(key) ? [`${path}.${key}`] : []),
    ...findSensitiveKeys(child, `${path}.${key}`),
  ]);
}

/**
 * An SSN written the way people write one (123-45-6789), anywhere in a string value. Undashed nine
 * digits are not flagged: policy numbers look like that.
 */
const SSN_SHAPE = /(^|[^\d-])\d{3}-\d{2}-\d{4}(?![\d-])/;

export function findSensitiveValues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSensitiveValues(item, `${path}[${index}]`));
  if (typeof value === "string") return SSN_SHAPE.test(value) ? [path] : [];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => findSensitiveValues(child, `${path}.${key}`));
}

const SSN_SHAPE_ALL = /(^|[^\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

/**
 * The value with every sensitive key removed and every SSN-shaped string masked ("***-**-6789").
 * One bad field must not take the whole response down: it goes, the rest is sent. `removed` lists
 * the paths, for the log.
 */
export function stripSensitive(value: unknown, path = "$", removed: string[] = []): { value: unknown; removed: string[] } {
  if (Array.isArray(value)) return { value: value.map((item, index) => stripSensitive(item, `${path}[${index}]`, removed).value), removed };
  if (typeof value === "string") {
    if (!SSN_SHAPE.test(value)) return { value, removed };
    removed.push(path);
    return { value: value.replace(SSN_SHAPE_ALL, (match: string, lead: string) => `${lead}***-**-${match.slice(-4)}`), removed };
  }
  if (!value || typeof value !== "object") return { value, removed };
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) { removed.push(`${path}.${key}`); continue; }
    out[key] = stripSensitive(child, `${path}.${key}`, removed).value;
  }
  return { value: out, removed };
}

/**
 * The lead fields a `leads:read` key sees: the ones needed to work a lead, read from the lead's form
 * values by name. Everything else in `values` (a template may hold anything) stays behind.
 */
export const LEAD_READ_FIELDS = ["first_name", "last_name", "phone", "email", "state", "zip", "city"] as const;

export function pickLeadFields(values: unknown): Record<string, string> {
  const source = values && typeof values === "object" && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const field of LEAD_READ_FIELDS) {
    const value = source[field];
    if (typeof value === "string" || typeof value === "number") out[field] = String(value).slice(0, 200);
  }
  return out;
}

/** Keyset paging cursor: base64url of `<sort value>|<id>`. */
export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null): { sortValue: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [sortValue, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!sortValue || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { sortValue, id };
  } catch {
    return null;
  }
}

/**
 * A cursor whose sort value is a timestamp, exactly as PostgREST writes one
 * ("2026-10-15T10:00:00.123456+00:00"). The value is placed inside a PostgREST `or=` filter, so
 * anything else — a comma, a parenthesis, a dot-operator — is refused, never passed on.
 */
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function decodeTimestampCursor(cursor: string | null): { sortValue: string; id: string } | null {
  const decoded = decodeCursor(cursor);
  if (!decoded || !CURSOR_TIMESTAMP.test(decoded.sortValue) || Number.isNaN(Date.parse(decoded.sortValue))) return null;
  return decoded;
}

/**
 * A policies cursor: carrier id (a uuid, checked by decodeCursor) and policy number. The policy
 * number goes inside a double-quoted PostgREST value, so a quote or a backslash — which would end or
 * escape it — refuses the cursor instead of being quietly dropped.
 */
export function decodePolicyCursor(cursor: string | null): { sortValue: string; id: string } | null {
  const decoded = decodeCursor(cursor);
  if (!decoded || decoded.sortValue.length > 120 || /["\\]/.test(decoded.sortValue) || /[\u0000-\u001f]/.test(decoded.sortValue)) return null;
  return decoded;
}

export function pageLimit(raw: string | null): number {
  const n = Number(raw ?? 50);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 100) : 50;
}
