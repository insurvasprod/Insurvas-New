import test from "node:test";
import assert from "node:assert/strict";

const { outstandingSubmitItems } = await import("./submitReadiness.ts");

test("LA-1.6-7: every missing requirement is named, in form order", () => {
  assert.deepEqual(
    outstandingSubmitItems({ screened: false, dncPending: false, missingRequired: ["First name", "Date of birth"], duplicateReasonMissing: true, consentGiven: false }),
    ["Phone screening", "First name", "Date of birth", "Reason this is a separate lead", "Consent"],
  );
  assert.deepEqual(
    outstandingSubmitItems({ screened: true, dncPending: true, missingRequired: [], duplicateReasonMissing: false, consentGiven: true }),
    ["DNC acknowledgement"],
  );
});

test("LA-1.6-7: nothing outstanding means an empty list", () => {
  assert.deepEqual(outstandingSubmitItems({ screened: true, dncPending: false, missingRequired: [], duplicateReasonMissing: false, consentGiven: true }), []);
});

test("the submit form renders the list and points the button at it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/partner/partner-portal-workspace.tsx", "utf8");
  assert.match(source, /outstandingSubmitItems\(/);
  assert.match(source, /Still needed to submit: \{outstanding\.join\(", "\)\}/);
  assert.match(source, /aria-describedby=\{formOpened && !canSubmit && outstanding\.length/);
});
