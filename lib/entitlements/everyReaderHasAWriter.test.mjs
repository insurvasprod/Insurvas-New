// Run with: npm test
//
// One defect shape, found five times across LA-1 and LA-2: a table with a schema, RLS policies,
// grants, an index tuned for a specific query, and readers — and nothing anywhere that writes a
// row. Every one of them was invisible, because each reader was written to cope with the absence:
//
//   tenant_agent_availability   book_appointment skips the working-hours check when there is no row
//   tenant_cadence_rules        schedule_next_attempt falls back to a built-in cadence
//   tenant_calling_windows      tenant_can_dial_now skips the tenant layer under `if found`
//   tenant_vendor_post_keys     the post endpoint 401s, which looks like a bad key
//   state_disclosures           the dialer says "Compliance has not published one" — and there was
//                               no Compliance screen to publish from
//
// Coping with absence is correct behaviour. It is also what hid the fact that the feature did not
// exist: nothing errored, nothing logged, and the only symptom was that the setting could not be
// found. The four tables below now have writers; this file fails if any of them loses one.
//
// Deliberately a source scan with no database: a test that queried the live project would pass on
// a deployment where somebody had inserted a row by hand, which is not the property being asserted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function sources() {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(join(root, "lib"));
  walk(join(root, "app"));
  return files;
}

const ALL = sources().map((path) => ({ path, text: readFileSync(path, "utf8") }));

/**
 * Files that can CREATE a row in `table` — an insert or upsert chained off `from("<table>")`.
 *
 * Two deliberate narrowings, both found by trying to break this file rather than by reasoning:
 *
 *   The mutation has to be the call immediately after `.from()`. A looser "the file names the
 *   table and mutates something" version did not fail when the calling-window writer was replaced
 *   with a select, because the same file also updates `tenant_campaigns` and that unrelated
 *   `.update(` kept it green.
 *
 *   `update` and `delete` do not count. They are writes, but every table here was empty — the
 *   defect was that no row could be created, not that no row could be changed. Counting them let
 *   the cadence assertion pass with every `insert` in the service removed, because a `.delete()`
 *   remained. A guard that stays green while the thing it guards is gone is worse than none.
 */
function writersOf(table) {
  const chained = new RegExp(`from\\(\\s*"${table}"\\s*\\)\\s*(?://[^\\n]*\\n\\s*)*\\.(insert|upsert)\\(`);
  return ALL.filter(({ path, text }) => !path.includes("database.types") && chained.test(text)).map(({ path }) =>
    path.replace(root, "").replace(/\\/g, "/"),
  );
}

function readersOf(table) {
  return ALL.filter(({ path, text }) => !path.includes("database.types") && text.includes(`"${table}"`)).map(
    ({ path }) => path.replace(root, "").replace(/\\/g, "/"),
  );
}

const TABLES = [
  {
    table: "tenant_cadence_rules",
    why: "an owner could not change when a lead is dialled again; every tenant ran the built-in cadence",
  },
  {
    table: "tenant_calling_windows",
    why: "an agency could not stop calling at 19:00; the tenant layer of the tightening rule was absent",
  },
  {
    table: "tenant_vendor_post_keys",
    why: "no vendor could be given a key, so the lead-post endpoint was unreachable in practice",
  },
  {
    table: "state_disclosures",
    why: "outbound dialing was blocked in every state, on every tenant, with no way to unblock it",
  },
];

for (const { table, why } of TABLES) {
  test(`${table} can have a row created in it`, () => {
    const writers = writersOf(table);
    assert.ok(
      writers.length > 0,
      `nothing can create a row in ${table} any more — ${why}. A reader with no writer is a feature that cannot be used, and the reader will not complain because it is written to cope with the absence.`,
    );
  });

  test(`${table} still has a reader`, () => {
    // The other direction. A writer whose reader has gone is a screen that saves settings nothing
    // consults — which looks even more like working software than the original defect did.
    assert.ok(readersOf(table).length > 0, `nothing reads ${table}, so whatever is saved to it reaches nobody`);
  });
}

test("a nav entry marked built points at a screen that exists", () => {
  // `/app/tcpa` and `/app/consent` were menu entries for routes that were never built. The menu's
  // own test covers the general case; these two are named because they were the LA-1/LA-2 ones,
  // and because an unbuilt compliance screen is the kind of gap that is only discovered on the day
  // a complaint arrives.
  for (const route of ["tcpa", "consent", "calendar", "lead-lists"]) {
    assert.ok(
      existsSync(join(root, "app", "app", "(shell)", route, "page.tsx")),
      `/app/${route} is in the navigation but has no page`,
    );
  }
});

test("the admin disclosure screen is reachable from the admin navigation", () => {
  const nav = readFileSync(join(root, "lib", "adminNav", "build.ts"), "utf8");
  assert.match(nav, /"\/admin\/state-disclosures"/, "nothing links to the disclosure publisher");
  assert.ok(
    existsSync(join(root, "app", "admin", "(protected)", "state-disclosures", "page.tsx")),
    "the disclosure publisher has a nav entry and no page",
  );
});
