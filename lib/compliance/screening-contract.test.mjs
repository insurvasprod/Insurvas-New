import test from "node:test";
import assert from "node:assert/strict";

const { parseTypedScreeningResponse } = await import("./screening-contract.ts");

test("typed TCPA and DNC responses are interpreted without prose matching", () => {
  assert.equal(parseTypedScreeningResponse({ hit: true }, "litigator_scrub").listed, true);
  assert.equal(parseTypedScreeningResponse({ is_litigator: false }, "litigator_scrub").listed, false);
  assert.equal(parseTypedScreeningResponse({ listed: true }, "dnc_scrub").listed, true);
  assert.equal(parseTypedScreeningResponse({ allowed: true }, "dnc_scrub").listed, false);
});

test("unknown or prose-only vendor answers fail closed", () => {
  assert.throws(() => parseTypedScreeningResponse({ message: "TCPA litigator hit" }, "litigator_scrub"), /typed screening decision/);
  assert.throws(() => parseTypedScreeningResponse({ listed: "false" }, "dnc_scrub"), /typed screening decision/);
  assert.throws(() => parseTypedScreeningResponse({ data: { answer: "clear" } }, "dnc_scrub"), /typed screening decision/);
});
