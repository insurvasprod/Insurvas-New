// Run with: npm test
//
// `state_disclosures` had a reader and no writer. The dialer read it on every call, found nothing,
// and reported — honestly — "No approved disclosure is configured. Dialing is blocked until
// Compliance publishes one." There was no Compliance screen. No seed, no route, no form, nothing
// anywhere in three planes could put a row in that table, so outbound dialing was blocked for every
// state, every product and every tenant, permanently, and the product said so in a sentence that
// read like a workflow step rather than a dead end.
//
// A table with readers and no writer is the shape this audit kept finding. These assertions fail in
// both directions: the publisher must exist and must reach the table, and the dialer must still be
// the thing that reads it — so deleting either half is caught here rather than in front of an agent
// who cannot make a call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => {
  const path = join(root, ...parts);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

test("something in the product can write a state disclosure", () => {
  const service = read("lib", "stateDisclosures", "service.ts");
  assert.ok(service, "lib/stateDisclosures/service.ts is missing — the publisher is gone");

  // `.upsert(` against this table is the write. A select-only service would satisfy a test that
  // only checked the file exists, which is how the original gap survived.
  const writes = /from\(\s*"state_disclosures"\s*\)\s*\n?\s*\.upsert\(/.test(service);
  assert.ok(writes, "the disclosure service no longer upserts into state_disclosures");

  assert.match(service, /\.delete\(\)/, "there is no way to withdraw a published disclosure");
});

test("the publisher is reachable over HTTP and role-gated", () => {
  const route = read("app", "api", "admin", "state-disclosures", "route.ts");
  assert.ok(route, "POST /api/admin/state-disclosures is missing — the service has no caller");
  assert.match(route, /publishStateDisclosure/, "the route no longer calls the publisher");
  assert.match(
    route,
    /requireAdminRole\(\s*CAN_MANAGE_STATE_DISCLOSURES\s*\)/,
    "publishing disclosures is no longer behind the admin role gate",
  );
  // Publishing changes what every agent in the product must read aloud on a recorded call, so it
  // is an audited act, not a settings tweak.
  assert.match(route, /state_disclosure\.published/, "publishing is no longer audited");
});

test("the screen that calls it exists and is in the navigation", () => {
  const page = read("app", "admin", "(protected)", "state-disclosures", "page.tsx");
  assert.ok(page, "there is no /admin/state-disclosures screen");
  assert.match(page, /StateDisclosuresTable/, "the screen no longer renders the table");

  const nav = read("lib", "adminNav", "build.ts");
  assert.match(
    nav,
    /"\/admin\/state-disclosures"/,
    "the disclosure screen exists but nothing links to it — an unreachable screen is not a publisher",
  );
});

test("the dialer still reads the table the publisher writes", () => {
  // If the dialer stops reading `state_disclosures`, publishing still "works" and stops mattering.
  // The two halves have to name the same table.
  const dialer = read("lib", "dialerScripts", "service.ts");
  assert.ok(dialer, "the dialer service is missing");
  assert.match(
    dialer,
    /from\("state_disclosures"\)/,
    "the dialer no longer reads state_disclosures, so published disclosures reach nobody",
  );
});

test("a published row matches what the dialer looks for", () => {
  // The dialer filters `state` (upper case) and `product_code` exactly. A publisher that stored
  // "Term Life" or "ca" would write rows the dialer can never find — the table would fill up and
  // dialing would stay blocked, which is worse than the empty table because it looks solved.
  const schemas = read("lib", "stateDisclosures", "schemas.ts");
  assert.ok(schemas, "the disclosure schemas are missing");
  assert.match(
    schemas,
    /\^\[a-z0-9_\]\+\$/,
    "product_code is no longer constrained to the lower-case form the dialer matches on",
  );

  const service = read("lib", "stateDisclosures", "service.ts");
  assert.match(
    service,
    /state:\s*state\.toUpperCase\(\)/,
    "published states are no longer upper-cased, so the dialer's `.eq(\"state\", STATE)` will miss them",
  );
});
