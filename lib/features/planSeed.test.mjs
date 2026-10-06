// Run with: npm test
//
// Two files state what the three reviewed v1 plans contain, and they must never disagree:
//
//   supabase/migrations/…_sa_2_3_plan_features.sql   what the database will actually grant
//   scripts/verify-entitlements.mjs                  what the acceptance check asserts
//
// The verifier's own comment explains why it hardcodes the lists rather than reading the catalog:
// "the verifier must fail if the catalog drifts, rather than reading the current catalog back and
// congratulating itself for matching its own mistake." That reasoning only holds while the two
// agree — the moment the seed changes and the verifier does not, it is asserting yesterday's
// product. This test is what notices, and it needs no database to do it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function migration(suffix) {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix));
  assert.ok(file, `missing migration ending ${suffix}`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * ('plan_code', 'feature_key') pairs from the plan_features seed, comments stripped, plus every
 * later migration's "grant these to the plans that already hold X" rule, applied in order. LA-3
 * (20260926100000) added ai_assistant, carrier_extension and sales_report that way, to the plans
 * holding `applications`; reading the seed alone missed them, and the verifier (rightly) saw them
 * live (found 2026-10-06, LA-4.10).
 */
function seededPlanFeatures() {
  const sql = migration("_sa_2_3_plan_features.sql").replace(/--[^\n]*/g, "");
  const start = sql.indexOf("insert into public.plan_features");
  assert.notEqual(start, -1, "no plan_features seed");

  const grouped = new Map();
  for (const [, code, key] of sql.slice(start).matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)) {
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(key);
  }

  const later = readdirSync(MIGRATIONS).filter((name) => name > readdirSync(MIGRATIONS).find((file) => file.endsWith("_sa_2_3_plan_features.sql"))).sort();
  for (const file of later) {
    const body = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    const rule = /insert into public\.plan_features[\s\S]*?cross join \(values ([^)]*(?:\)[^)]*)*?)\) as f\(key\)\s+where pf\.feature_key = '([a-z_]+)'/g;
    for (const [, values, holder] of body.matchAll(rule)) {
      const keys = [...values.matchAll(/'([a-z_]+)'/g)].map(([, key]) => key);
      for (const features of grouped.values()) {
        if (!features.includes(holder)) continue;
        for (const key of keys) if (!features.includes(key)) features.push(key);
      }
    }
  }
  return grouped;
}

/** The plan codes and versions seeded into `plans`. */
function seededPlans() {
  const sql = migration("_sa_2_3_plan_features.sql").replace(/--[^\n]*/g, "");
  const start = sql.indexOf("insert into public.plans");
  assert.notEqual(start, -1, "no plans seed");
  const body = sql.slice(start, sql.indexOf("on conflict", start));
  return [...body.matchAll(/\(\s*'([a-z_]+)'\s*,\s*(\d+)\s*,\s*'[^']*'\s*,\s*'([a-z_]+)'/g)].map(
    ([, code, version, planType]) => ({ code, version: Number(version), planType }),
  );
}

/** EXPECTED_FEATURES from the verifier, read as text — importing it would need a database. */
function expectedFeatures() {
  const source = readFileSync(join(ROOT, "scripts", "verify-entitlements.mjs"), "utf8");
  const start = source.indexOf("const EXPECTED_FEATURES");
  assert.notEqual(start, -1, "EXPECTED_FEATURES not found in verify-entitlements.mjs");
  const block = source.slice(start, source.indexOf("};", start));

  const expected = new Map();
  for (const [, code, list] of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    expected.set(
      code,
      [...list.matchAll(/"([a-z_]+)"/g)].map(([, key]) => key),
    );
  }
  return expected;
}

const seeded = seededPlanFeatures();
const expected = expectedFeatures();

test("both sources parsed", () => {
  assert.ok(expected.size > 0, "no expected plans parsed from the verifier");
  assert.ok(seeded.size > 0, "no plan features parsed from the migration");
});

test("the migration seeds exactly the plans the verifier looks for", () => {
  // verify-entitlements.mjs queries plans where version = 1 and code in (...), then asserts the
  // count matches. A missing plan there reads as "all reviewed v1 plans exist — FAIL" with no clue
  // which one.
  const plans = seededPlans();
  assert.deepEqual(
    plans.map((plan) => plan.code).sort(),
    [...expected.keys()].sort(),
    "seeded plan codes differ from the verifier's EXPECTED_FEATURES keys",
  );
  for (const plan of plans) {
    assert.equal(plan.version, 1, `${plan.code} must be seeded at version 1`);
    assert.equal(plan.planType, "individual", `${plan.code} must be an individual plan`);
  }
});

test("every plan grants exactly the reviewed feature set", () => {
  for (const [code, wanted] of expected) {
    const actual = [...(seeded.get(code) ?? [])].sort();
    assert.deepEqual(
      actual,
      [...wanted].sort(),
      `plan "${code}" would grant a different set than the verifier asserts`,
    );
  }
});

test("no plan is seeded that the verifier does not know about", () => {
  const unknown = [...seeded.keys()].filter((code) => !expected.has(code)).sort();
  assert.deepEqual(unknown, [], `seeded but unverified plans: ${unknown.join(", ")}`);
});

test("every granted feature exists in the catalog", () => {
  // plan_features_feature_key_fkey enforces this in the database. Catching it here means a bad
  // seed fails in CI rather than partway through applying the migration.
  const catalog = migration("_sa_2_1_feature_catalog.sql").replace(/--[^\n]*/g, "");
  const start = catalog.indexOf("insert into public.features");
  const body = catalog.slice(catalog.indexOf("values", start), catalog.indexOf("on conflict", start));
  const known = new Set([...body.matchAll(/\(\s*'([a-z_]+)'/g)].map(([, key]) => key));
  // Later migrations add to the catalog too (LA-3's three Sell flags): every
  // "insert into public.features (feature_key, …) values (…)" counts.
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    for (const [, values] of sql.matchAll(/insert into public\.features \(feature_key[^)]*\) values([\s\S]*?)on conflict/g)) {
      for (const [, key] of values.matchAll(/\(\s*'([a-z_]+)'/g)) known.add(key);
    }
  }

  const missing = [...new Set([...seeded.values()].flat())].filter((key) => !known.has(key)).sort();
  assert.deepEqual(missing, [], `granted by a plan but absent from the feature catalog: ${missing.join(", ")}`);
});

test("plans are strictly nested, cheapest to dearest", () => {
  // Not a Notion requirement, but these three are a ladder and an accidental gap — a feature in
  // basic that pro drops — would silently downgrade a customer who upgrades.
  const basic = new Set(expected.get("basic") ?? []);
  const pro = new Set(expected.get("pro") ?? []);
  const advance = new Set(expected.get("advance") ?? []);

  const lostOnUpgrade = [
    ...[...basic].filter((key) => !pro.has(key)).map((key) => `basic→pro loses ${key}`),
    ...[...pro].filter((key) => !advance.has(key)).map((key) => `pro→advance loses ${key}`),
  ];
  assert.deepEqual(lostOnUpgrade, [], lostOnUpgrade.join("; "));
});

test("no plan grants a feature twice", () => {
  for (const [code, keys] of seeded) {
    assert.equal(new Set(keys).size, keys.length, `duplicate feature rows seeded for "${code}"`);
  }
});
