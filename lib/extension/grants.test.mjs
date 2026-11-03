// LA-3.12 grant rules, as pure checks — no database. Each test is one line of the decisions:
// a token is scoped to ONE application and ONE carrier origin, lives exactly 60 minutes, is refused
// once revoked (the row decides, on every request), and the bulk payload never carries the SSN or a
// bank / card number.
//
// Run with: node --experimental-strip-types --test lib/extension/grants.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { signGrantToken, verifyGrantToken, checkGrant, grantExpiry, httpsOrigin, bearerToken, signingKey, grantStatus } = await import("./token.ts");
const { buildBulkPayload, assertBulkSafe, splitGroups, withoutSensitive, fillMap } = await import("./payload.ts");
const { applyTransform } = await import("./transforms.ts");
const { GRANT_LIFETIME_MINUTES } = await import("./constants.ts");

const KEY = signingKey("test-signing-key-that-is-at-least-32-characters");
const OTHER_KEY = signingKey("another-signing-key-that-is-at-least-32-chars!");
const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const APP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GRANT = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://producer.example-mutual.test";

function grant(issuedAt, overrides = {}) {
  const claims = { jti: GRANT, sub: USER, tenantId: TENANT, applicationId: APP_A, origin: ORIGIN, scope: "read_application_fields" };
  const row = {
    id: GRANT, tenant_id: TENANT, user_id: USER, application_id: APP_A, carrier_origin: ORIGIN, scope: "read_application_fields",
    issued_at: issuedAt.toISOString(), expires_at: grantExpiry(issuedAt).toISOString(), revoked_at: null, ...overrides,
  };
  return { claims, row };
}

async function issued(issuedAt = new Date()) {
  const { claims, row } = grant(issuedAt);
  const token = await signGrantToken(claims, KEY, issuedAt);
  return { token, claims, row };
}

test("a grant lives exactly 60 minutes", () => {
  const at = new Date("2026-09-28T10:00:00.000Z");
  assert.equal(GRANT_LIFETIME_MINUTES, 60);
  assert.equal(grantExpiry(at).getTime() - at.getTime(), 60 * 60 * 1000);
});

test("a fresh token for application A verifies and passes for A on its own origin", async () => {
  const { token, row } = await issued();
  const verified = await verifyGrantToken(token, KEY);
  assert.equal(verified.ok, true);
  assert.deepEqual(checkGrant({ claims: verified.claims, row, origin: ORIGIN, applicationId: APP_A }), { ok: true });
});

test("a token for application A is refused for application B", async () => {
  const { token, row } = await issued();
  const { claims } = await verifyGrantToken(token, KEY);
  assert.deepEqual(checkGrant({ claims, row, origin: ORIGIN, applicationId: APP_B }), { ok: false, reason: "application_mismatch" });
  // …and a row that names B while the token names A (a swapped jti) is refused too.
  assert.deepEqual(checkGrant({ claims, row: { ...row, application_id: APP_B }, origin: ORIGIN }), { ok: false, reason: "application_mismatch" });
});

test("the wrong origin is refused — no suffix match, no http, no missing header", async () => {
  const { token, row } = await issued();
  const { claims } = await verifyGrantToken(token, KEY);
  for (const origin of ["https://evil.example", "https://producer.example-mutual.test.evil.example", "http://producer.example-mutual.test", "https://sub.producer.example-mutual.test", null, "null"]) {
    assert.deepEqual(checkGrant({ claims, row, origin }), { ok: false, reason: "origin_mismatch" }, String(origin));
  }
  // The row decides the origin, not the token alone.
  assert.deepEqual(checkGrant({ claims, row: { ...row, carrier_origin: "https://agents.example-aetna.test" }, origin: ORIGIN }), { ok: false, reason: "origin_mismatch" });
});

test("an expired token is refused, by the signature check and by the row", async () => {
  const issuedAt = new Date(Date.now() - 61 * 60 * 1000);
  const { token, row } = await issued(issuedAt);
  const verified = await verifyGrantToken(token, KEY);
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "expired");
  // The claims still come back (signature was good), so the refusal can be logged against the grant.
  assert.equal(verified.claims?.jti, GRANT);
  // A row past its expiry is refused even if a token clock disagreed.
  const fresh = await issued();
  assert.deepEqual(checkGrant({ claims: fresh.claims, row: { ...fresh.row, expires_at: new Date(Date.now() - 1000).toISOString() }, origin: ORIGIN }), { ok: false, reason: "expired" });
  assert.equal(grantStatus(row), "expired");
});

test("a revoked grant is refused although its token is still valid", async () => {
  const { token, row } = await issued();
  const verified = await verifyGrantToken(token, KEY);
  assert.equal(verified.ok, true);
  const revoked = { ...row, revoked_at: new Date().toISOString() };
  assert.deepEqual(checkGrant({ claims: verified.claims, row: revoked, origin: ORIGIN, applicationId: APP_A }), { ok: false, reason: "revoked" });
  assert.equal(grantStatus(revoked), "revoked");
  // No row at all (deleted, or a jti that was never issued) is refused.
  assert.deepEqual(checkGrant({ claims: verified.claims, row: null, origin: ORIGIN }), { ok: false, reason: "not_found" });
});

test("a token signed with another key, or tampered with, is invalid", async () => {
  const { token } = await issued();
  assert.equal((await verifyGrantToken(token, OTHER_KEY)).reason, "invalid_token");
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload.app = APP_B;
  const forged = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
  assert.equal((await verifyGrantToken(forged, KEY)).reason, "invalid_token");
  assert.equal((await verifyGrantToken(null, KEY)).reason, "missing_token");
});

test("a token of another tenant or user does not match the row", async () => {
  const { token, row } = await issued();
  const { claims } = await verifyGrantToken(token, KEY);
  assert.equal(checkGrant({ claims, row: { ...row, tenant_id: APP_B }, origin: ORIGIN }).reason, "tenant_mismatch");
  assert.equal(checkGrant({ claims, row: { ...row, user_id: APP_B }, origin: ORIGIN }).reason, "user_mismatch");
});

test("helpers: https origins only, bearer parsing, key length", () => {
  assert.equal(httpsOrigin("https://portal.example.test/eapp/start?x=1"), "https://portal.example.test");
  assert.equal(httpsOrigin("http://portal.example.test"), null);
  assert.equal(httpsOrigin("javascript:alert(1)"), null);
  assert.equal(bearerToken("Bearer a.b.c"), "a.b.c");
  assert.equal(bearerToken("Basic a.b.c"), null);
  assert.equal(signingKey("short"), null);
});

// ── the bulk payload ────────────────────────────────────────────────────────

const SENSITIVE = ["insured.ssn", "pay.routing_number", "pay.account_number", "pay.card_number"];
const SSN = "123456789";
const ROUTING = "021000021";
const ACCOUNT = "000123456789";
const CARD = "4111111111111111";

function sampleInputs() {
  return {
    application: { id: APP_A, attemptNo: 1, clientName: "Rita Alvarez", carrierName: "Mutual of Omaha", productLabel: "Living Promise" },
    grant: { id: GRANT, origin: ORIGIN, expiresAt: new Date().toISOString() },
    groups: [
      { key: "insured", label: "Proposed insured", items: [
        { key: "insured.first_name", label: "First name", name: "first name", display: "Rita", copy: "Rita" },
        { key: "insured.dob", label: "Date of birth", name: "date of birth", display: "03/14/1953", copy: "03/14/1953" },
        { key: "insured.ssn", label: "Social Security number", name: "SSN", display: "••••6789", copy: null, sensitive: { masked: "••••6789" } },
      ] },
      { key: "pay", label: "Banking and payment", items: [
        { key: "pay.method", label: "Payment method", name: "payment method", display: "Bank draft (ACH)", copy: "Bank draft (ACH)" },
        { key: "pay.routing_number", label: "Routing number", name: "routing number", display: "••••0021", copy: null, sensitive: { masked: "••••0021" } },
        // A careless upstream that put the real number in `copy` must still not leak it.
        { key: "pay.account_number", label: "Account number", name: "account number", display: ACCOUNT, copy: ACCOUNT, sensitive: { masked: "••••6789" } },
      ] },
    ],
    // Raw values with every sensitive key present — they must all be dropped.
    values: { "insured.first_name": "Rita", "insured.dob": "1953-03-14", "insured.gender": "female", "insured.ssn": SSN, "pay.routing_number": ROUTING, "pay.account_number": ACCOUNT, "pay.card_number": CARD, "pay.method": "ach" },
    map: {
      id: "44444444-4444-4444-8444-444444444444", version: 3, status: "published",
      steps: [{ id: "s1", page_key: "applicant", url_pattern: "/eapp/applicant", sort_order: 0 }],
      entries: [
        { id: "e1", step_id: "s1", field_key: "insured.dob", selector: "#dob", selector_fallback: null, input_kind: "date", value_transform: "mmddyyyy", option_map: null },
        { id: "e2", step_id: "s1", field_key: "insured.gender", selector: "input[name=sex]", selector_fallback: null, input_kind: "radio", value_transform: null, option_map: { female: "F", male: "M" } },
        { id: "e3", step_id: "s1", field_key: "insured.ssn", selector: "#ssn", selector_fallback: null, input_kind: "masked", value_transform: "digits_only", option_map: null },
        { id: "e4", step_id: "s1", field_key: "pay.card_number", selector: "#card", selector_fallback: null, input_kind: "masked", value_transform: "digits_only", option_map: null },
      ],
    },
    ticks: ["insured.first_name"],
  };
}

test("the bulk payload contains no sensitive key and no sensitive value", () => {
  const payload = buildBulkPayload(sampleInputs());
  const json = JSON.stringify(payload);
  for (const secret of [SSN, ROUTING, ACCOUNT, CARD]) assert.equal(json.includes(secret), false, `${secret} leaked into the bulk payload`);
  for (const key of SENSITIVE) {
    assert.equal(key in payload.values, false, `values.${key}`);
    assert.equal(payload.groups.some((g) => g.items.some((i) => i.key === key)), false, `groups item ${key}`);
  }
  // Sensitive fields are listed by mask only, for the one-at-a-time read.
  assert.deepEqual(payload.sensitive.map((s) => s.key).sort(), ["insured.ssn", "pay.account_number", "pay.routing_number"]);
  assert.ok(payload.sensitive.every((s) => /^•+\d{0,4}$/.test(s.masked)));
  // Map entries for sensitive fields carry no value — the extension fetches them by entry.
  const entries = payload.map.steps.flatMap((s) => s.entries);
  assert.ok(entries.filter((e) => SENSITIVE.includes(e.fieldKey)).every((e) => e.sensitive && e.value === null));
});

test("map values are transformed server-side, deterministically", () => {
  const payload = buildBulkPayload(sampleInputs());
  const byKey = Object.fromEntries(payload.map.steps.flatMap((s) => s.entries).map((e) => [e.fieldKey, e.value]));
  assert.equal(byKey["insured.dob"], "03/14/1953");
  assert.equal(byKey["insured.gender"], "F");
  assert.equal(applyTransform("yes", "yes_no_yn"), "Y");
  assert.equal(applyTransform("tx", "state_code"), "TX");
  assert.equal(applyTransform("Texas", "state_code"), null, "never guess a state code");
  assert.equal(applyTransform("x", "some_future_transform"), null, "an unknown transform fills nothing");
  assert.equal(applyTransform(null, "none"), null);
});

test("assertBulkSafe throws on a leak instead of hiding it", () => {
  const payload = buildBulkPayload(sampleInputs());
  assert.throws(() => assertBulkSafe({ ...payload, values: { ...payload.values, "insured.ssn": SSN } }), /Sensitive field/);
  const leakyMap = { ...payload.map, steps: payload.map.steps.map((s) => ({ ...s, entries: s.entries.map((e) => (e.fieldKey === "insured.ssn" ? { ...e, value: SSN } : e)) })) };
  assert.throws(() => assertBulkSafe({ ...payload, map: leakyMap }), /Sensitive field/);
  assert.equal(Object.keys(withoutSensitive({ "pay.card_number": CARD, "addr.zip": "76102" })).join(), "addr.zip");
  assert.equal(splitGroups([{ key: "g", label: "G", items: [{ key: "pay.card_number", label: "Card", name: "card", display: CARD, copy: CARD }] }]).groups[0].items.length, 0);
  assert.equal(fillMap(null, {}), null);
});
