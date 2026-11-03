import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { demoDncAllowed, demoScreeningListed, demoScreeningOutage, DEMO_OUTAGE_SUFFIX } = await import("./demo.ts");

test("LA-2.3-7: a demo outage number gets no answer from either feed", () => {
  assert.equal(DEMO_OUTAGE_SUFFIX, "0503");
  assert.equal(demoScreeningOutage("6025550503"), true);
  assert.equal(demoScreeningOutage("6025550103"), false);
  assert.throws(() => demoScreeningListed("dnc_scrub", "6025550503"), { name: "DemoVendorOutageError" });
  assert.throws(() => demoScreeningListed("litigator_scrub", "6025550503"), { name: "DemoVendorOutageError" });
  // The dial's live DNC lookup goes through the same answer, so it fails too, never "allowed".
  assert.throws(() => demoDncAllowed("6025550503"), { name: "DemoVendorOutageError" });
  // Every other scenario is unchanged.
  assert.equal(demoScreeningListed("dnc_scrub", "6025550101"), true);
  assert.equal(demoScreeningListed("litigator_scrub", "6025550001"), true);
  assert.equal(demoDncAllowed("6025550103"), true);
});

test("LA-2.3-7: the demo provider's failure is caught as a vendor failure, not a clear", () => {
  // screening.ts calls demoScreeningListed inside the provider's check(), which runProviderType
  // wraps in try/catch and turns into a thrown vendor error, and screenAgainstLists turns that into
  // "unavailable". This pins the call site so a refactor cannot move it outside the provider.
  const screening = readFileSync(new URL("./screening.ts", import.meta.url), "utf8");
  assert.match(screening, /async check\(phoneDigits\) \{\s*const listed = demoScreeningListed\(vendorType, phoneDigits\)/);
});
