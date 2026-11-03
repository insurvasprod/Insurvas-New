/**
 * The authentication preamble is four round trips to a remote database, and they must not be
 * sequential.
 *
 * Measured against the live project on 2026-09-18, warm, one at a time:
 *
 *   membership (resolveTenantContext)   219 ms
 *   maintenance status                  183 ms
 *   entitlement                         171 ms
 *   feature kill switch                ~170 ms
 *                                      -------
 *   preamble, run one after another    ~740 ms   before any route did its own work
 *
 * The transfer inbox measured 903 ms end to end against a 1,000 ms budget, and 722 ms of it was this
 * function — so the suite failed intermittently (1,154 ms and 1,565 ms in the 2026-09-18 audit) while
 * the inbox query itself was never the problem. Fetching the four concurrently took it to ~530 ms.
 *
 * None of the four depends on another's result: `tenantId` comes from the session JWT, which is
 * signed by us and verified before any of them run.
 *
 * WHAT MUST NOT CHANGE is the decision order. Maintenance is evaluated before entitlement so that
 * locked mode cannot reveal whether a tenant has a plan, and the kill switch is evaluated before
 * entitlement so a paying customer is never told their plan lacks a feature that is off for
 * everyone. Concurrency here is about fetching, never about branching.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(process.cwd(), "lib", "entitlements", "requireFeature.ts"), "utf8");
const body = (name) => {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
};

test("requireFeature fetches its four reads concurrently", () => {
  const code = body("requireFeature").replace(/\/\/[^\n]*/g, "");
  assert.match(code, /await Promise\.all\(\[/, "the preamble is sequential again");
  for (const call of ["requireTenant()", "getMaintenanceStatus()", "getEntitlement(session.tenantId)", "featureKillState(featureKey, session.tenantId)"]) {
    const inParallel = code.slice(code.indexOf("Promise.all(["), code.indexOf("]);", code.indexOf("Promise.all([")));
    assert.ok(inParallel.includes(call), `${call} is not in the parallel batch`);
  }
  // Each must appear exactly once: a leftover sequential await would re-add the round trip it saves.
  for (const call of ["getMaintenanceStatus(", "featureKillState("]) {
    assert.equal(code.split(call).length - 1, 1, `${call} is called more than once`);
  }
});

test("requireWriteAccess fetches its three reads concurrently", () => {
  const code = body("requireWriteAccess").replace(/\/\/[^\n]*/g, "");
  assert.match(code, /await Promise\.all\(\[/);
  const inParallel = code.slice(code.indexOf("Promise.all(["), code.indexOf("]);", code.indexOf("Promise.all([")));
  for (const call of ["requireTenant()", "getMaintenanceStatus()", "getEntitlement(session.tenantId)"]) {
    assert.ok(inParallel.includes(call), `${call} is not in the parallel batch`);
  }
});

test("the decision order is unchanged: maintenance, then kill switch, then entitlement", () => {
  const code = body("requireFeature");
  const at = (needle) => {
    const i = code.indexOf(needle);
    assert.notEqual(i, -1, `${needle} is missing`);
    return i;
  };
  // Branches, not fetches. These three comparisons are the security contract of this function.
  assert.ok(at('maintenance.level === "locked"') < at("kill.killed"), "entitlement/kill decided before maintenance");
  assert.ok(at("kill.killed") < at("hasFeature(entitlement, featureKey)"), "entitlement decided before the kill switch");
});

test("an unauthenticated request does no speculative work", () => {
  // A request with no session must not read a tenant's entitlement or kill switch at all — there is
  // no tenant id to read them for, and doing the work would be a free way to probe.
  const code = body("requireFeature");
  const guard = code.slice(code.indexOf("const session = await getTenantSession()"), code.indexOf("Promise.all(["));
  assert.match(guard, /if \(!session\) \{/);
  assert.match(guard, /return unauthenticated instanceof NextResponse/);
});
