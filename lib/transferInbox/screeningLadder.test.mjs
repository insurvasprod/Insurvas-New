import assert from "node:assert/strict";
import test from "node:test";

import { screeningLadder } from "./screeningLadder.ts";

const states = (ladder) => Object.fromEntries(ladder.steps.map((step) => [step.key, step.state]));

test("a tenant-list DNC hit stops the ladder; later checks were not reached", () => {
  const ladder = screeningLadder({ outcome: "dnc", resultId: null });
  assert.deepEqual(states(ladder), { phone: "passed", tenant_dnc: "match", litigator: "not_reached", dnc_registry: "not_reached", duplicate: "not_reached" });
});

test("a registry DNC hit carries a result id and passes the tenant list", () => {
  const ladder = screeningLadder({ outcome: "dnc", resultId: "r1" });
  assert.equal(states(ladder).tenant_dnc, "passed");
  assert.equal(states(ladder).dnc_registry, "match");
  assert.equal(states(ladder).duplicate, "passed");
});

test("duplicate and clear", () => {
  assert.equal(states(screeningLadder({ outcome: "internal_dq", resultId: "r" })).duplicate, "match");
  const clear = screeningLadder({ outcome: "clear", resultId: "r" });
  assert.ok(clear.steps.every((step) => step.state === "passed"));
  assert.equal(clear.checked, true);
});

test("unscreened or unavailable is unknown, never clear", () => {
  for (const outcome of [null, "unavailable"]) {
    const ladder = screeningLadder({ outcome, resultId: null });
    assert.equal(ladder.checked, false);
    assert.equal(states(ladder).litigator, "unknown");
  }
});
