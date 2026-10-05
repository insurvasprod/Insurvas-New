// Run with: npm test
//
// SA-2.1 names its own CI check: "every `feature_key` in this table is referenced by at least one
// `requireFeature()` guard". That check normally needs the database. This file gets it without
// one, by reading the seed out of the migration and comparing it to the two places the
// application names features: the menu definition and the agent API policy registry.
//
// Both directions matter and they fail differently:
//   a key in the code but not the catalog  -> the guard can never be satisfied; nobody can buy it
//   a key in the catalog but not the code  -> a plan can sell a feature that enforces nothing
//
// The second is the one that costs money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { FEATURE_KEY_PATTERN } from "./constants.ts";
import { allMenuItems } from "../menu/definition.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function seedMigration() {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith("_sa_2_1_feature_catalog.sql"));
  assert.ok(file, "the SA-2.1 feature catalog migration is missing");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * The value tuples of one `insert into public.<table> … values (…)` statement, as arrays of
 * columns. Column counts differ per table (modules are 3-wide, features 4-wide), so the tuple is
 * returned as-is rather than forced into a shape.
 */
function seededRows(sql, table) {
  const start = sql.indexOf(`insert into public.${table}`);
  assert.notEqual(start, -1, `no seed insert for ${table}`);
  const body = sql
    .slice(sql.indexOf("values", start), sql.indexOf("on conflict", start))
    // Comments in the seed contain parentheses of their own — `requireFeature()` in the note
    // explaining partner_quality was being parsed as an empty tuple.
    .replace(/--[^\n]*/g, "");

  return [...body.matchAll(/\(([^()]*)\)/g)]
    .map(([, tuple]) =>
      [...tuple.matchAll(/'((?:[^']|'')*)'|(-?\d+)/g)].map(([, quoted, number]) =>
        quoted === undefined ? Number(number) : quoted.replace(/''/g, "'"),
      ),
    )
    .filter((tuple) => tuple.length > 0);
}

/**
 * Features added to the catalog after SA-2.1, by a later migration that inserts in the same
 * four-column shape — LA-3 adds `ai_assistant`, `carrier_extension` and `sales_report` this way.
 */
function laterFeatureRows(seedFile) {
  const rows = [];
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f > seedFile).sort()) {
    const text = readFileSync(join(MIGRATIONS, name), "utf8");
    if (!/insert into public\.features \(feature_key, label, module, sort_order\)/.test(text)) continue;
    rows.push(...seededRows(text, "features"));
  }
  return rows;
}

const sql = seedMigration();
const seedFile = readdirSync(MIGRATIONS).find((name) => name.endsWith("_sa_2_1_feature_catalog.sql"));
const modules = seededRows(sql, "feature_modules").map(([key, label, sort_order]) => ({ key, label, sort_order }));
const features = [...seededRows(sql, "features"), ...laterFeatureRows(seedFile)].map(([feature_key, label, module, sort_order]) => ({
  feature_key,
  label,
  module,
  sort_order,
}));

/** Every feature key the application actually enforces or advertises. */
function referencedKeys() {
  const fromMenu = allMenuItems()
    .map((item) => item.required_feature)
    .filter(Boolean);
  const fromApi = AGENT_API_POLICIES.map((policy) => policy.featureKey).filter(Boolean);
  return new Set([...fromMenu, ...fromApi]);
}

test("the seed parsed at all", () => {
  assert.ok(modules.length >= 8, `expected the module seed, got ${modules.length}`);
  assert.ok(features.length >= 27, `expected the feature seed, got ${features.length}`);
});

test("every feature the code references exists in the catalog", () => {
  // A guard whose key is absent can never be satisfied: the tenant cannot be granted a feature
  // no plan can tick, so the route is permanently 403 for everyone.
  const seeded = new Set(features.map((feature) => feature.feature_key));
  const missing = [...referencedKeys()].filter((key) => !seeded.has(key)).sort();
  assert.deepEqual(missing, [], `referenced by the app but absent from the catalog seed: ${missing.join(", ")}`);
});

test("every feature in the catalog is enforced somewhere", () => {
  // SA-2.1's own CI criterion. A catalog entry with no guard is a feature a plan can sell and
  // nothing delivers.
  const referenced = referencedKeys();
  const unenforced = features
    .map((feature) => feature.feature_key)
    .filter((key) => !referenced.has(key))
    .sort();
  assert.deepEqual(
    unenforced,
    [],
    `in the catalog but no requireFeature() guard or menu node references them: ${unenforced.join(", ")}`,
  );
});

test("every seeded feature names a seeded module", () => {
  // The database enforces this with features_module_fkey; catching it here means a bad seed fails
  // in CI rather than halfway through applying the migration.
  const moduleKeys = new Set(modules.map((module) => module.key));
  const orphans = features.filter((feature) => !moduleKeys.has(feature.module)).map((f) => `${f.feature_key}→${f.module}`);
  assert.deepEqual(orphans, [], `features pointing at a module that is not seeded: ${orphans.join(", ")}`);
});

test("every feature key is a legal key", () => {
  const illegal = features.map((f) => f.feature_key).filter((key) => !FEATURE_KEY_PATTERN.test(key));
  assert.deepEqual(illegal, [], `keys that would not survive becoming a guard name: ${illegal.join(", ")}`);
});

test("feature keys are unique", () => {
  const keys = features.map((feature) => feature.feature_key);
  assert.equal(new Set(keys).size, keys.length, "duplicate feature_key in the seed");
});

test("modules are uniquely keyed and ordered", () => {
  const keys = modules.map((module) => module.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate module key in the seed");
});

test("sort order is unique within each module", () => {
  // The catalog is displayed grouped by module and ordered by sort_order; a tie makes the order
  // depend on whatever the database returns first.
  const seen = new Map();
  const clashes = [];
  for (const feature of features) {
    const slot = `${feature.module}#${feature.sort_order}`;
    if (seen.has(slot)) clashes.push(`${seen.get(slot)} and ${feature.feature_key} both at ${slot}`);
    seen.set(slot, feature.feature_key);
  }
  assert.deepEqual(clashes, [], clashes.join("; "));
});

test("the agency module is seeded with no features under it", () => {
  // SA-2.1 puts agency features out of scope but asks for the module to exist, so an admin can
  // see that the section is real and empty rather than missing.
  assert.ok(modules.some((module) => module.key === "agency"), "the agency module should be seeded");
  assert.deepEqual(features.filter((feature) => feature.module === "agency"), []);
});
