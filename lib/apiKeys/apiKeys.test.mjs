import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { API_SCOPE_KEYS, IDLE_DAYS, apiKeyStatus, isIdleKey } from "./constants.ts";
import { API_ROUTES, API_SCOPE_FEATURE, bearerApiKey, decideKey, decodeCursor, decodePolicyCursor, decodeTimestampCursor, encodeCursor, findSensitiveKeys, findSensitiveValues, generateApiKey, hashApiKey, pickLeadFields, scopeAllows, stripSensitive } from "./rules.ts";
import { COMMISSION_FIELDS, LEAD_FIELDS, POLICY_FIELDS } from "./fields.ts";

// LA-8.7 acceptance criteria, one test each where a test can hold them.

const MIGRATION = fs.readFileSync(path.join("supabase", "migrations", "20261015340000_la_8_7_api_keys_webhooks.sql"), "utf8");
const read = (file) => fs.readFileSync(file, "utf8");

test("the key is shown once: only its hash, prefix and last four are stored", () => {
  const minted = generateApiKey();
  assert.match(minted.key, /^isk_[A-Za-z0-9_-]{43}$/);
  assert.equal(minted.hash, hashApiKey(minted.key));
  assert.match(minted.hash, /^[0-9a-f]{64}$/);
  assert.equal(minted.prefix, minted.key.slice(0, 12));
  assert.equal(minted.lastFour, minted.key.slice(-4));
  // The table has no column a key could sit in, and refuses anything but a hash in key_hash.
  const table = /create table if not exists public\.api_key \(([\s\S]*?)\n\);/.exec(MIGRATION)[1];
  assert.doesNotMatch(table, /\bkey text\b|key_plain|key_value|secret/);
  assert.match(table, /key_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  // The service never selects the hash, and the create route returns the key only in its POST.
  const service = read("lib/apiKeys/service.ts");
  assert.doesNotMatch(/const COLUMNS = "([^"]+)"/.exec(service)[1], /key_hash/);
  assert.doesNotMatch(read("app/api/app/api-keys/route.ts"), /keyPrefix: created\.record\.keyPrefix[^}]*key:/);
});

test("scopes are explicit: there is no full-access scope, in code or in the table", () => {
  assert.deepEqual([...API_SCOPE_KEYS].sort(), ["commissions:read", "leads:read", "leads:write", "policies:read", "webhooks:manage"]);
  for (const scope of API_SCOPE_KEYS) assert.doesNotMatch(scope, /\*|all|admin|full/);
  assert.match(MIGRATION, /cardinality\(scopes\) between 1 and 5/);
  assert.match(read("app/api/app/api-keys/route.ts"), /\.min\(1, "Choose at least one scope"\)/);
});

test("every scope is refused on every route it does not name (a leads:write key gets 403 on commissions)", () => {
  for (const scope of API_SCOPE_KEYS) {
    for (const [route, needed] of Object.entries(API_ROUTES)) {
      const decision = decideKey({ revoked_at: null, expires_at: null, scopes: [scope] }, route, Date.now());
      if (needed === scope) assert.deepEqual(decision, { ok: true }, `${scope} on ${route}`);
      else assert.equal(decision.ok === false && decision.status, 403, `${scope} on ${route}`);
    }
  }
  assert.equal(scopeAllows("GET /api/v1/commissions", ["leads:write"]), false);
  assert.equal(decideKey({ revoked_at: null, expires_at: null, scopes: ["leads:write"] }, "GET /api/v1/commissions", Date.now()).status, 403);
});

test("every /api/v1 route authenticates with its own entry in API_ROUTES", () => {
  const routes = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name === "route.ts") routes.push(full); } };
  walk(path.join("app", "api", "v1"));
  const seen = new Set();
  for (const file of routes) {
    const source = read(file);
    const url = "/" + path.dirname(file).split(path.sep).join("/").replace(/^app\//, "").replace(/\[id\]/g, ":id");
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
      if (!new RegExp(`export async function ${method}\\(`).test(source)) continue;
      const route = `${method} ${url}`;
      assert.ok(route in API_ROUTES, `${route} is not in API_ROUTES`);
      assert.ok(source.includes(`authenticateApiKey(request, "${route}")`), `${file} ${method} does not authenticate as "${route}"`);
      assert.ok(!/NextResponse\.json\(/.test(source), `${file} answers without apiJson's sensitive-field guard`);
      seen.add(route);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(API_ROUTES).sort());
});

test("each scope sits behind the plan feature the screens use", () => {
  assert.deepEqual(Object.keys(API_SCOPE_FEATURE).sort(), [...API_SCOPE_KEYS].sort());
  assert.equal(API_SCOPE_FEATURE["leads:write"], "lead_import");
  assert.equal(API_SCOPE_FEATURE["commissions:read"], "statement_ingestion");
});

test("revocation and expiry are decided from the stored row, with one answer for all three", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const base = { scopes: ["policies:read"], revoked_at: null, expires_at: null };
  assert.deepEqual(decideKey(base, "GET /api/v1/policies", now), { ok: true });
  const revoked = decideKey({ ...base, revoked_at: "2026-10-15T11:59:59Z" }, "GET /api/v1/policies", now);
  const expired = decideKey({ ...base, expires_at: "2026-10-15T11:00:00Z" }, "GET /api/v1/policies", now);
  const missing = decideKey(null, "GET /api/v1/policies", now);
  assert.deepEqual(revoked, missing);
  assert.deepEqual(expired, missing);
  assert.equal(missing.status, 401);
  // Read per request: the gate selects revoked_at and expires_at from the row every time, no cache.
  const gate = read("lib/apiKeys/authenticate.ts");
  assert.match(gate, /select\("id, tenant_id, scopes, revoked_at, expires_at/);
  assert.doesNotMatch(gate, /new Map\(|keyCache|lru/i);
});

test("rotation keeps the old key working until the overlap ends, and both are visible", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const old = { revokedAt: null, expiresAt: "2026-10-16T12:00:00Z" };
  assert.equal(apiKeyStatus(old, true, now), "rotating_out");
  assert.equal(apiKeyStatus(old, true, Date.parse("2026-10-16T12:00:01Z")), "expired");
  assert.deepEqual(decideKey({ revoked_at: null, expires_at: old.expiresAt, scopes: ["leads:read"] }, "GET /api/v1/leads", now), { ok: true });
  assert.equal(apiKeyStatus({ revokedAt: null, expiresAt: null }, false, now), "active");
  const service = read("lib/apiKeys/service.ts");
  assert.match(service, /overlapHours \* 3_600_000/);
  assert.match(read("lib/apiKeys/constants.ts"), /DEFAULT_ROTATION_OVERLAP_HOURS = 24/);
});

test("a key idle for 90 days gets the revoke prompt; last use and its address are recorded", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const day = 86_400_000;
  const key = (lastUsedAt, createdAt = "2026-01-01T00:00:00Z") => ({ lastUsedAt, createdAt, expiresAt: null, revokedAt: null });
  assert.equal(IDLE_DAYS, 90);
  assert.equal(isIdleKey(key(new Date(now - 89 * day).toISOString()), now), false);
  assert.equal(isIdleKey(key(new Date(now - 90 * day).toISOString()), now), true);
  assert.equal(isIdleKey(key(null, new Date(now - 91 * day).toISOString()), now), true);
  assert.equal(isIdleKey({ ...key(null), revokedAt: "2026-02-01T00:00:00Z" }, now), false);
  assert.match(read("lib/apiKeys/authenticate.ts"), /update\(\{ last_used_at: new Date\(\)\.toISOString\(\), last_used_ip: ip \}\)/);
});

test("only a Bearer isk_ key is read from the header", () => {
  const { key } = generateApiKey();
  assert.equal(bearerApiKey(`Bearer ${key}`), key);
  assert.equal(bearerApiKey(`bearer ${key}`), key);
  assert.equal(bearerApiKey("Bearer lpk_abcdefghijklmnopqrstuvwxyz"), null);
  assert.equal(bearerApiKey(key), null);
  assert.equal(bearerApiKey(null), null);
});

test("no API response contains an SSN, bank account or card number", () => {
  // The guard every /api/v1 response passes through.
  assert.deepEqual(findSensitiveKeys({ data: [{ policy_number: "P-1", premium_cents: 4500 }] }), []);
  assert.deepEqual(findSensitiveKeys({ data: [{ ssn: "x" }] }), ["$.data[0].ssn"]);
  for (const name of ["ssn", "social_security_number", "routing_number", "account_number", "bank_account", "bankAccountNumber", "card_number", "cardNumber", "cvv", "iban", "tax_id", "taxId", "payee_tin", "client_ssn", "pan"]) {
    assert.equal(findSensitiveKeys({ [name]: "x" }).length, 1, name);
  }
  // Whole words only: a name that merely contains a fragment is not sensitive (LA-8 audit).
  for (const name of ["bank_descriptor", "bank_name", "card_count", "scorecard", "cardinality", "japan", "span", "martin", "destination", "routing_rule", "account_status", "panel"]) {
    assert.deepEqual(findSensitiveKeys({ [name]: "x" }), [], name);
  }
  assert.deepEqual(findSensitiveValues({ note: "SSN 123-45-6789 on file" }), ["$.note"]);
  assert.deepEqual(findSensitiveValues({ policy_number: "123456789", phone: "5551234567", date: "2026-10-15T00:00:00Z" }), []);
  // Each endpoint's column list is itself clean.
  for (const [name, list] of Object.entries({ POLICY_FIELDS, COMMISSION_FIELDS, LEAD_FIELDS })) {
    const columns = Object.fromEntries(list.split(",").map((c) => [c.trim(), 1]));
    assert.deepEqual(findSensitiveKeys(columns), [], name);
  }
  // A lead's form values pass through an allow-list: nothing else comes out.
  assert.deepEqual(pickLeadFields({ first_name: "Ann", ssn: "123-45-6789", bank_account: "1", phone: "5551234567", notes: "x" }), { first_name: "Ann", phone: "5551234567" });
  // A stray sensitive field is stripped (an SSN-shaped string masked) and the rest is sent — never a 500 for the whole response.
  const stripped = stripSensitive({ data: [{ policy_number: "P-1", ssn: "123-45-6789", note: "SSN 123-45-6789 on file", bank_descriptor: "SAFE HARBOUR" }] });
  assert.deepEqual(stripped.value, { data: [{ policy_number: "P-1", note: "SSN ***-**-6789 on file", bank_descriptor: "SAFE HARBOUR" }] });
  assert.deepEqual(stripped.removed, ["$.data[0].ssn", "$.data[0].note"]);
  const guard = read("lib/apiKeys/authenticate.ts");
  assert.match(guard, /const clean = stripSensitive\(body\);/);
  assert.match(guard, /NextResponse\.json\(clean\.value,/);
  assert.doesNotMatch(guard, /The response could not be sent/);
});

test("a cursor is validated before it reaches a PostgREST filter", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(decodeTimestampCursor(encodeCursor("2026-10-15T10:00:00.123456+00:00", id)), { sortValue: "2026-10-15T10:00:00.123456+00:00", id });
  for (const bad of ["2026-10-15T10:00:00Z,id.gt.0", "2026-10-15)", "x", "2026-13-45T99:99:99Z", "2026-10-15T10:00:00+00:00,and(tenant_id.neq.x)"]) {
    assert.equal(decodeTimestampCursor(encodeCursor(bad, id)), null, bad);
  }
  assert.deepEqual(decodePolicyCursor(encodeCursor("P-12 34", id)), { sortValue: "P-12 34", id });
  assert.equal(decodePolicyCursor(encodeCursor('P"),tenant_id.neq.(x', id)), null);
  assert.equal(decodePolicyCursor(encodeCursor("P\\", id)), null);
  for (const route of ["app/api/v1/leads/route.ts", "app/api/v1/commissions/route.ts"]) assert.match(read(route), /const cursor = decodeTimestampCursor\(params\.get\("cursor"\)\);/, route);
  assert.match(read("app/api/v1/policies/route.ts"), /decodePolicyCursor\(raw\)/);
});

test("rotation keeps an end date, undoes itself on failure, and happens once per key", () => {
  const service = read("lib/apiKeys/service.ts");
  // The new key keeps the old key's end date — never "no expiry" for a key that had one.
  assert.match(service, /expiresAt: old\.expires_at,\n\s+rotatedFrom: old\.id,/);
  // A failed shortening withdraws the new key.
  assert.match(service, /if \(shortened\.error \|\| !shortened\.data\?\.length\) \{[\s\S]*?revoked_at: new Date\(\)\.toISOString\(\)[\s\S]*?\.eq\("id", minted\.record\.id\)/);
  // Once per key, here and in the database.
  assert.match(service, /\.eq\("rotated_from", old\.id\)\.is\("revoked_at", null\)/);
  assert.match(read("supabase/migrations/20261015640000_la_8_audit_team_webhooks.sql"), /create unique index if not exists api_key_one_rotation on public\.api_key \(rotated_from\) where rotated_from is not null and revoked_at is null;/);
  assert.match(read("app/api/app/api-keys/[id]/rotate/route.ts"), /ApiKeyAlreadyRotatedError\) return NextResponse\.json\(\{ error: error\.message, code: "already_rotated" \}, \{ status: 409 \}\)/);
});

test("cursors round-trip and refuse what this API did not give out", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(decodeCursor(encodeCursor("2026-10-15T10:00:00.123+00:00", id)), { sortValue: "2026-10-15T10:00:00.123+00:00", id });
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor(null), null);
});

test("the settings routes are tenant-admin only", () => {
  for (const file of ["app/api/app/api-keys/route.ts", "app/api/app/api-keys/[id]/route.ts", "app/api/app/api-keys/[id]/rotate/route.ts", "app/api/app/webhooks/route.ts", "app/api/app/webhooks/[id]/route.ts", "app/api/app/webhooks/[id]/test/route.ts"]) {
    const source = read(file);
    const handlers = source.match(/export async function \w+\(/g) ?? [];
    const gates = source.match(/requireTenant\(\["owner"\]\)/g) ?? [];
    assert.ok(handlers.length > 0 && gates.length === handlers.length, `${file}: ${gates.length} owner gates for ${handlers.length} handlers`);
  }
});
