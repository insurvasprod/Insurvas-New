// Run with: npm test
//
// SA-2.5 opens by insisting that limits and meters are two different things. This file holds that
// line, plus the two invariants the acceptance criteria turn on: usage events are append-only, and
// a meter the code consumes must exist in the catalog.
//
// A meter key the code consumes but the catalog does not know is a silent metering hole — the
// capacity check returns 'not_metered' and every call sails through unmeasured.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function migration(suffix) {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith(suffix));
  assert.ok(file, `missing migration ending ${suffix}`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

const sql = migration("_sa_2_5_limits_and_meters.sql");

/** ('key','unit','label',bool,n) tuples from the meters seed. */
function seededMeters() {
  const start = sql.indexOf("insert into public.meters");
  assert.notEqual(start, -1, "no meters seed");
  const body = sql.slice(sql.indexOf("values", start), sql.indexOf("on conflict", start)).replace(/--[^\n]*/g, "");
  return [...body.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z]+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(\d+)\s*\)/g)].map(
    ([, meter_key, unit, label, hardCap, sort]) => ({
      meter_key,
      unit,
      label,
      default_hard_cap: hardCap === "true",
      sort_order: Number(sort),
    }),
  );
}

/** Meter keys the application actually consumes. */
function meteredInCode() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
        walk(path);
      } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
        for (const [, key] of readFileSync(path, "utf8").matchAll(/meterKey:\s*["'`]([a-z_]+)["'`]/g)) {
          found.add(key);
        }
      }
    }
  };
  for (const root of ["app", "lib"]) {
    try {
      statSync(join(ROOT, root));
      walk(join(ROOT, root));
    } catch {
      // not present in this checkout
    }
  }
  return found;
}

const meters = seededMeters();

test("the meter catalogue seeded", () => {
  assert.equal(meters.length, 6, `expected the six SA-2.5 meters, got ${meters.length}`);
});

test("every meter the code consumes exists in the catalogue", () => {
  // Otherwise check_meter_capacity returns 'not_metered' and the call is never counted — the
  // allowance silently does not exist.
  const known = new Set(meters.map((meter) => meter.meter_key));
  const missing = [...meteredInCode()].filter((key) => !known.has(key)).sort();
  assert.deepEqual(missing, [], `consumed by the app but absent from the meters seed: ${missing.join(", ")}`);
});

test("the catalogue matches the SA-2.5 seed table exactly", () => {
  assert.deepEqual(
    meters.map((meter) => meter.meter_key).sort(),
    ["dialer_minutes", "dnc_lookups", "esign_envelopes", "sms_segments", "statement_pages", "tcpa_checks"],
  );
});

test("statement_pages is the only meter that does not hard-cap by default", () => {
  // Straight from the SA-2.5 seed table. Getting this backwards would either block statement
  // imports at an allowance nobody set, or let a capped meter run free.
  const soft = meters.filter((meter) => !meter.default_hard_cap).map((meter) => meter.meter_key);
  assert.deepEqual(soft, ["statement_pages"]);
});

test("meter keys and sort order are unique", () => {
  const keys = meters.map((meter) => meter.meter_key);
  const orders = meters.map((meter) => meter.sort_order);
  assert.equal(new Set(keys).size, keys.length, "duplicate meter_key");
  assert.equal(new Set(orders).size, orders.length, "duplicate sort_order");
});

test("usage events are append-only at the grant level, not just by convention", () => {
  // "Usage events are never deleted; corrections are new negative events." A comment saying so is
  // not enforcement — the grant is.
  assert.match(
    sql,
    /revoke update, delete on public\.usage_events from service_role;/,
    "usage_events must have update and delete revoked even from service_role",
  );
});

test("the aggregate is rebuildable from the log", () => {
  // The criterion is that usage_totals can be reconstructed entirely by replaying usage_events.
  // If rebuild_usage_totals ever reads anything but the event log, the totals stop being derived.
  const start = sql.indexOf("create or replace function public.rebuild_usage_totals");
  assert.notEqual(start, -1, "rebuild_usage_totals is missing");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assert.match(body, /from public\.usage_events/, "the rebuild must read the event log");

  // `delete from public.usage_totals` is expected — clearing the derived table is the first half
  // of a replay. Only the tables it READS are in question here.
  const reads = [...body.replace(/delete\s+from\s+public\.[a-z_]+/g, "").matchAll(/from public\.([a-z_]+)/g)].map(
    ([, table]) => table,
  );
  assert.deepEqual([...new Set(reads)], ["usage_events"], "the rebuild must read nothing but the event log");
});

test("idempotency is enforced by a unique index, per tenant", () => {
  // "The same usage event posted twice counts once." Scoped per tenant so two tenants cannot
  // collide on a shared external id and silently suppress each other's usage.
  assert.match(
    sql,
    /create unique index if not exists usage_events_idempotency_idx\s*\n?\s*on public\.usage_events \(tenant_id, idempotency_key\)/,
    "idempotency must be a unique index on (tenant_id, idempotency_key)",
  );
});

test("an individual plan is seeded at one seat", () => {
  // SA-2.2: an individual plan is "always 1". It is the one limit specified rather than left to
  // the business, so it is the one that gets seeded.
  assert.match(
    sql,
    /insert into public\.plan_limits \(plan_id, max_seats\)[\s\S]{0,200}?plan_type = 'individual'/,
    "individual plans should be seeded with max_seats = 1",
  );
});

test("no meter allowance is invented", () => {
  // Allowances are business figures pinned nowhere. Seeding a guess into a table that enforcement
  // reads would silently cap a paying customer at a number nobody chose.
  assert.ok(
    !/insert into public\.plan_meters/.test(sql),
    "plan_meters must not be seeded with guessed allowances",
  );
});
