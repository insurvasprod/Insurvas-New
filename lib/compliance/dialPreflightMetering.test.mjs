// Run with: node --experimental-strip-types --test lib/compliance/dialPreflightMetering.test.mjs
//
// SA-2 audit (2026-10-15): the dial preflight's litigator lookup checked the tcpa_checks allowance
// and recorded the charge as two statements, so parallel checks could all pass. The charge is now
// the capacity check too (consume_meter_capacity, the locked path DNC lookups use), still made only
// for an answer actually received.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "lib", "compliance", "screening.ts"), "utf8");
const start = source.indexOf("export async function checkLitigatorForDialPreflight");
const preflight = source.slice(start, source.indexOf("\n}\n", start));

test("the litigator charge is atomic with its capacity check", () => {
  assert.match(preflight, /await consumeMeterCapacity\(\{ tenantId: input\.tenantId, meterKey: "tcpa_checks", qty: 1, idempotencyKey: `\$\{ref\}:tcpa`, ref \}\)/);
  assert.doesNotMatch(preflight, /recordUsage\(/, "no unguarded record after a separate check");
});

test("a refusal at charge time is 'allowance used up', never a 'clear'", () => {
  const afterCharge = preflight.slice(preflight.indexOf("const charged = await consumeMeterCapacity"));
  assert.match(afterCharge, /if \(!charged\.allowed\) \{[\s\S]{0,300}result: "unavailable"[\s\S]{0,120}The plan's screening allowance is used up\./);
});

test("it is still charged only after the vendor answered, once per number per day", () => {
  assert.ok(preflight.indexOf("runProviderType(") < preflight.indexOf("consumeMeterCapacity("), "the vendor is asked before the charge");
  assert.match(preflight, /const ref = `dial-preflight:\$\{input\.tenantId\}:\$\{input\.phoneDigits\}:\$\{now\.toISOString\(\)\.slice\(0, 10\)\}`;/);
});
