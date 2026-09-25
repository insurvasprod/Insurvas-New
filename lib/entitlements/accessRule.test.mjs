// Run with: npm test
//
// The rule "a suspended tenant can always still read their own book of business — suspend the
// doing, preserve the seeing" now exists twice: once in accessLevelForStatus() and once in the
// SQL function entitlement_access_for_status(), because the entitlement is computed in the
// database and enforced in the application.
//
// Two implementations of one rule is exactly how a product ends up locking a paying customer out
// of their own records on a billing hiccup. This reads the mapping back out of the migration and
// fails if the two stop agreeing — including if someone adds a subscription status and only
// teaches one side about it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SUBSCRIPTION_STATUSES, accessLevelForStatus } from "../subscriptions/access.ts";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/**
 * The LAST migration to define a function, in filename order, is the one that will be live.
 * Pinning a specific migration would let a later one silently reintroduce exactly the bug these
 * tests exist to catch — SA-2.5 already supersedes SA-2.8's refresh_tenant_entitlement.
 */
function latestDefining(signature) {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(signature));
  assert.ok(file, `no migration defines ${signature}`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

const ENGINE = "create or replace function public.refresh_tenant_entitlement";

function sqlMapping() {
  const sql = latestDefining("create or replace function public.entitlement_access_for_status");

  const start = sql.indexOf("create or replace function public.entitlement_access_for_status");
  assert.notEqual(start, -1, "entitlement_access_for_status is not defined in the migration");
  const body = sql.slice(start, sql.indexOf("$$;", start));

  const mapping = new Map();
  for (const [, status, access] of body.matchAll(/when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/g)) {
    mapping.set(status, access);
  }
  return mapping;
}

const mapping = sqlMapping();

test("the SQL mapping was found and parsed", () => {
  assert.ok(mapping.size > 0, "no when/then pairs parsed out of entitlement_access_for_status");
});

test("the database and the application agree on every subscription status", () => {
  const disagreements = [];
  for (const status of SUBSCRIPTION_STATUSES) {
    const fromCode = accessLevelForStatus(status);
    const fromSql = mapping.get(status);
    if (fromSql === undefined) disagreements.push(`${status}: missing from the SQL mapping`);
    else if (fromSql !== fromCode) disagreements.push(`${status}: SQL says ${fromSql}, code says ${fromCode}`);
  }
  assert.deepEqual(disagreements, [], disagreements.join("; "));
});

test("the SQL mapping has no status the application does not know", () => {
  const known = new Set(SUBSCRIPTION_STATUSES);
  const extra = [...mapping.keys()].filter((status) => !known.has(status)).sort();
  assert.deepEqual(extra, [], `in SQL but not in SUBSCRIPTION_STATUSES: ${extra.join(", ")}`);
});

test("suspended and paused keep read access — the rule the product rests on", () => {
  // Stated explicitly rather than left implicit in the loop above, because this is the one that
  // must never quietly become 'none' during a refactor.
  assert.equal(mapping.get("suspended"), "read_only");
  assert.equal(mapping.get("paused"), "read_only");
  assert.equal(accessLevelForStatus("suspended"), "read_only");
  assert.equal(accessLevelForStatus("paused"), "read_only");
});

test("only cancelled removes access entirely", () => {
  const none = [...mapping.entries()].filter(([, access]) => access === "none").map(([status]) => status);
  assert.deepEqual(none, ["cancelled"]);
});

test("chasing payment does not break the product", () => {
  // past_due is full access with a banner. Downgrading it would suspend a customer for a failed
  // card before anyone has tried to fix the card.
  assert.equal(mapping.get("past_due"), "full");
  assert.equal(accessLevelForStatus("past_due"), "full");
});

test("the rebuild empties features only for cancelled", () => {
  // The engine keeps a suspended tenant's feature list and empties a cancelled one's. Checked
  // against the migration text because it is a branch, not a mapping.
  const sql = latestDefining(ENGINE);
  assert.match(
    sql,
    /if v_status = 'cancelled' then\s*[\s\S]{0,400}?v_features := '\[\]'::jsonb;/,
    "the engine should empty features for cancelled and only for cancelled",
  );
});

test("the rebuild does not filter archived features out of an entitlement", () => {
  // SA-2.1: "archiving a feature does not break plans that already reference it — it stays
  // enforced for existing subscribers and disappears from the picker." Filtering on is_archived
  // inside the entitlement build would revoke a live subscriber's feature the moment an admin
  // tidied the catalog.
  const sql = latestDefining(ENGINE);
  const start = sql.indexOf("into v_features");
  const selectBlock = sql.slice(start, sql.indexOf(";", start));
  assert.ok(
    !/is_archived/.test(selectBlock),
    "the entitlement feature query must not filter on is_archived",
  );
});
