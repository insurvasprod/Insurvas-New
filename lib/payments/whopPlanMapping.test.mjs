/**
 * `whop_plans` is a record of fact, not demo data.
 *
 * Each row asserts "our plan X exists on Whop as plan Y", and `ensureWhopPlan` returns any row it
 * finds WITHOUT asking Whop — deliberately, since that saves a round trip on every checkout. The
 * consequence is that a wrong row is believed forever.
 *
 * `scripts/seed-demo-data.mjs` used to seed six invented ids (`plan_demo_m_0`, `plan_demo_y_0`, …).
 * None of them existed on Whop — confirmed by listing the account's real plans, which returned four
 * genuine ids and none of the six. So `ensureWhopPlan` short-circuited on a fabricated mapping,
 * `POST /checkout_configurations` answered `404 This Plan was not found`, and checkout could never
 * open. `verify:checkout` had never passed.
 *
 * The fix is that the seeder does not touch the table at all: the mapping fills itself in on the
 * first real sale of each (plan version, billing cycle), which is what `ensureWhopPlan` is for.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("the demo seeder does not fabricate Whop plan mappings", () => {
  const seeder = read("scripts", "seed-demo-data.mjs");
  const code = seeder.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /seed\("whop_plans"/, "the seeder writes to whop_plans again");
  assert.doesNotMatch(code, /plan_demo_/, "the seeder invents Whop plan ids again");
});

test("a stale mapping names itself instead of producing an opaque 500", () => {
  // Before: Whop's 404 escaped as an unhandled error, the route logged a stack and the buyer saw
  // "Could not open checkout". Nothing anywhere named the one bad row that caused it.
  const start = read("lib", "checkout", "start.ts");
  const code = start.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /status === 404/);
  assert.match(code, /no longer exists on Whop/);
  assert.match(code, /whop_plans maps it to/);
  // A CheckoutError, so the route answers 409 with the reason rather than 500 with nothing.
  assert.match(code, /throw new CheckoutError\(\s*\n?\s*`The stored Whop plan/);
});
