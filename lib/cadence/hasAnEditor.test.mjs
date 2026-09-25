// Run with: npm test
//
// LA-2.7 criterion 2 is "cadence rows can be added, edited and deleted, per campaign". Everything
// needed for that existed except the part that does it: `tenant_cadence_rules` had a schema with a
// `campaign_id` override column, an engine in engine.ts with slot rules and interval validation,
// two SQL readers — and no writer, no route and no screen. The table was empty on every tenant.
//
// What made it invisible is that both readers fall back to a hard-coded default cadence when they
// find no row. So the dialer behaved sensibly, nothing errored, and the only symptom of a feature
// that did not exist was that nobody could find it.
//
// These assertions fail in both directions: the editor must reach the table, and the readers must
// still be reading the table the editor writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => {
  const path = join(root, ...parts);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

test("something in the product can write a cadence row", () => {
  const service = read("lib", "cadence", "service.ts");
  assert.ok(service, "lib/cadence/service.ts is missing — the cadence has no writer again");
  assert.match(
    service,
    /from\("tenant_cadence_rules"\)\s*\n?\s*\.insert\(/,
    "the cadence service no longer inserts into tenant_cadence_rules",
  );
  assert.match(service, /\.delete\(\)/, "rows can no longer be deleted, so a cadence cannot be shortened");
});

test("a failed save does not silently drop the tenant onto the built-in cadence", () => {
  // The set is replaced, so there is a window where the old rows are gone and the new ones have
  // not landed. If the insert fails there and nothing puts the old rows back, the tenant falls
  // through to the default cadence with no error and no trace — the original bug, re-created by
  // the fix for it.
  const service = read("lib", "cadence", "service.ts");
  assert.match(service, /previous/, "the previous rows are no longer captured before the delete");
  assert.match(
    service,
    /could not be put back/i,
    "a failed restore no longer reports itself, so losing a cadence would look like a failed save",
  );
});

test("the editor is reachable over HTTP, role-gated and audited", () => {
  const route = read("app", "api", "app", "cadence", "route.ts");
  assert.ok(route, "GET/PUT /api/app/cadence is missing — the service has no caller");
  assert.match(route, /saveCadence/, "the route no longer calls the writer");
  assert.match(route, /requireFeatureRole\("outbound_dialing"/, "the cadence route is no longer behind the dialing entitlement");
  assert.match(route, /tenant\.cadence_updated/, "changing the cadence is no longer audited");
});

test("duplicate and gapped cadences are refused by the route", () => {
  // Both matter more than they look. The unique key does NOT catch duplicates, because Postgres
  // treats NULLs in a unique index as distinct and a tenant-default catch-all rule is NULL in two
  // of the four key columns — so this check is the only one. A gap is not a constraint violation
  // at all: the reader looks up `attempt_number = v_next` exactly, so a missing attempt falls
  // through to the built-in delay rather than to the rule above it.
  const route = read("app", "api", "app", "cadence", "route.ts");
  assert.match(route, /duplicate_attempt/, "duplicate attempts are no longer refused");
  assert.match(route, /gap_in_cadence/, "a cadence with a missing attempt is no longer refused");
});

test("an invalid delay is refused before the database sees it", () => {
  const route = read("app", "api", "app", "cadence", "route.ts");
  assert.match(
    route,
    /parseInterval/,
    "the route no longer validates delays through the engine, so `banana` reaches Postgres as an interval",
  );
});

test("the editor is mounted somewhere a person can reach", () => {
  const component = read("components", "app", "cadence-settings.tsx");
  assert.ok(component, "the cadence editor component is missing");

  const tabs = read("components", "app", "agent-settings-tabs.tsx");
  assert.match(tabs, /CadenceSettings/, "the cadence editor is no longer rendered by the settings tabs");

  const page = read("app", "app", "(shell)", "settings", "page.tsx");
  assert.match(page, /tabs=\{SETTINGS_SECTIONS\}/, "the settings page no longer draws its rail from the shared section list");
  const sections = read("lib", "settings", "sections.ts");
  assert.match(
    sections,
    /id: "cadence"/,
    "the settings page no longer offers the cadence tab — an unmounted editor is not an editor",
  );
});

test("per-campaign overrides are actually reachable", () => {
  // The schema comment says the old system had per-campaign overrides "unreachable from the UI".
  // Rebuilding an editor that only ever writes the tenant default would reproduce exactly that.
  const service = read("lib", "cadence", "service.ts");
  assert.match(service, /campaign_id: input\.scope\.campaignId/, "saved rows no longer carry the campaign scope");
  const component = read("components", "app", "cadence-settings.tsx");
  assert.match(component, /campaignId/, "the editor no longer lets anyone pick a campaign");
});

test("the schedulers still read the table the editor writes", () => {
  const dir = join(root, "supabase", "migrations");
  const readers = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => readFileSync(join(dir, name), "utf8").includes("from tenant_cadence_rules"));
  assert.ok(
    readers.length > 0,
    "no migration reads tenant_cadence_rules any more, so a saved cadence would reach nothing",
  );
});
