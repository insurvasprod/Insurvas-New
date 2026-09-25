import test from "node:test";
import assert from "node:assert/strict";

const { demoDncAllowed, demoScreeningListed, demoScreeningResponse } = await import("./demo.ts");

test("demo screening keeps clear, DNC, and TCPA scenarios deterministic", () => {
  assert.equal(demoScreeningListed("dnc_scrub", "6025550101"), true);
  assert.equal(demoScreeningListed("dnc_scrub", "6025550103"), false);
  assert.equal(demoScreeningListed("litigator_scrub", "6025550001"), true);
  assert.equal(demoScreeningListed("litigator_scrub", "6025550103"), false);
  assert.equal(demoDncAllowed("6025550101"), false);
  assert.equal(demoDncAllowed("6025550103"), true);
  assert.deepEqual(demoScreeningResponse("dnc_scrub", false), { demo: true, listed: false });
  assert.deepEqual(demoScreeningResponse("litigator_scrub", true), { demo: true, hit: true });
});
