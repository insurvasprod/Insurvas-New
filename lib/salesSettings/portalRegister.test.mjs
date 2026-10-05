// LA-3.22 · the carrier portal register holds no password — not a column, not a schema key, not a
// payload field — and LA-3.6 / 3.17 carrier facts and products are validated before they are stored.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const { portalAccountSchema, PORTAL_SECRET_NAME } = await import("./portalSchemas.ts");
const { carrierFactsSchema, addCarrierSchema, createProductSchema, updateProductSchema, toHttpsOrigin, toHttpsUrl } = await import("./carrierSchemas.ts");

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const valid = { carrier_id: "0f8fad5b-d9cb-469f-a165-70867728950e", portal_url: "https://agents.example.test/login", username: "northline.rg", writing_number: "884102", mfa_type: "app", notes: null, last_verified_on: "2026-09-26" };

test("3.22: no key of any portal or carrier schema names a password, secret, token, PIN or credential", () => {
  for (const schema of [portalAccountSchema, carrierFactsSchema, addCarrierSchema]) {
    for (const key of Object.keys(schema.shape)) assert.doesNotMatch(key, PORTAL_SECRET_NAME, key);
  }
});

test("3.22: the API refuses a body that carries a password", () => {
  assert.equal(portalAccountSchema.safeParse(valid).success, true);
  for (const key of ["password", "portal_password", "secret", "token", "pin"]) {
    assert.equal(portalAccountSchema.safeParse({ ...valid, [key]: "hunter2" }).success, false, `${key} was accepted`);
  }
});

test("3.22: no migration gives the portal register or carrier settings a secret column", () => {
  const offenders = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    for (const table of ["tenant_carrier_portal_accounts", "tenant_carrier_settings"]) {
      const create = new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
      const columns = create ? create[1].split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c ?? "")) : [];
      const added = [...sql.matchAll(new RegExp(`alter table public\\.${table}[\\s\\S]*?add column (?:if not exists )?([a-z_]+)`, "g"))].map((m) => m[1]);
      for (const c of [...columns, ...added]) if (PORTAL_SECRET_NAME.test(c)) offenders.push(`${file}: ${table}.${c}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("3.22: the portal URL must be https; the scheme is added when an owner leaves it off", () => {
  assert.equal(portalAccountSchema.safeParse({ ...valid, portal_url: "http://agents.example.test" }).success, false);
  assert.equal(toHttpsUrl("agents.example.test/login"), "https://agents.example.test/login");
  assert.equal(toHttpsUrl("agents.example.test"), "https://agents.example.test");
  assert.equal(toHttpsUrl("http://agents.example.test"), null);
});

test("3.17: carrier facts — an https origin, a pattern that compiles, a descriptor of at most 60", () => {
  assert.equal(toHttpsOrigin("agents.example.test/login"), "https://agents.example.test");
  assert.equal(carrierFactsSchema.safeParse({ portal_origin: "https://agents.example.test", reference_pattern: "^GL-\\d{8}$", billing_descriptor: "GERBER LIFE INS" }).success, true);
  assert.equal(carrierFactsSchema.safeParse({ portal_origin: "https://agents.example.test/login", reference_pattern: null, billing_descriptor: null }).success, false);
  assert.equal(carrierFactsSchema.safeParse({ portal_origin: null, reference_pattern: "^(GL", billing_descriptor: null }).success, false);
  assert.equal(carrierFactsSchema.safeParse({ portal_origin: null, reference_pattern: null, billing_descriptor: "X".repeat(61) }).success, false);
});

const product = {
  product_code: "final_expense", name: "Living Promise", tiers: ["level", "graded"], issue_age_min: 45, issue_age_max: 85, face_min_cents: 200000, face_max_cents: 5000000,
  band_min: "2.10", band_max: "14.80", accepted_payment_methods: ["ach", "direct_express"], is_active: true,
};

test("3.6: a product's ranges must be in order and money is integer cents", () => {
  assert.equal(updateProductSchema.safeParse(product).success, true);
  assert.equal(updateProductSchema.safeParse({ ...product, issue_age_min: 90 }).success, false);
  assert.equal(updateProductSchema.safeParse({ ...product, face_min_cents: 6000000 }).success, false);
  assert.equal(updateProductSchema.safeParse({ ...product, band_min: "15.00" }).success, false);
  assert.equal(updateProductSchema.safeParse({ ...product, face_min_cents: 2000.5 }).success, false);
  assert.equal(createProductSchema.safeParse({ ...product, carrier_id: valid.carrier_id }).success, true);
});

test("3.25: term fields are for term products only; a term product carries lengths and health classes", () => {
  assert.equal(updateProductSchema.safeParse({ ...product, term_lengths: [10, 20] }).success, false);
  const term = { ...product, product_code: "term_life", tiers: [], term_lengths: [10, 20, 30], health_classes: ["Preferred", "Standard"], exam_required_above_face_cents: 25000000, convertible: true, conversion_deadline_rule: "Before age 70", renewal_type: "level" };
  assert.equal(updateProductSchema.safeParse(term).success, true);
  assert.equal(updateProductSchema.safeParse({ ...term, tiers: ["level"] }).success, false);
  assert.equal(updateProductSchema.safeParse({ ...term, term_lengths: [45] }).success, false);
});
