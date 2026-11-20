// Application / case workspace walk (2026-11-20, a Term Life lead from interview to review): each
// test is one defect found on the walk, kept fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { feetAndInches, isHeightQuestion, totalInches } = await import("./heightInput.ts");
const { prefillFromInterview } = await import("./prefill.ts");
const { initialFaceCents } = await import("./quoteFace.ts");
const { faceAmountCents } = await import("../appointments/appointmentFacts.ts");
const { runQa } = await import("./qa.ts");
const { FIXTURE_ATTEMPT, FIXTURE_CASE } = await import("./fixtures.ts");
const { productLineLabel } = await import("../format/productLine.ts");
const { PRODUCT_LABEL } = await import("./constants.ts");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("1 · the interview asks height in feet and inches and stores total inches, as the application does", () => {
  assert.equal(isHeightQuestion("height_in", "number"), true);
  assert.equal(isHeightQuestion("height", "number"), true, "the older synonyms count");
  assert.equal(isHeightQuestion("height_in", "text"), false);
  assert.equal(isHeightQuestion("weight_lb", "number"), false);
  assert.deepEqual(feetAndInches(70), { feet: "5", inches: "10" });
  assert.deepEqual(feetAndInches(null), { feet: "", inches: "" });
  assert.equal(totalInches("5", "10"), 70);
  assert.equal(totalInches("6", ""), 72, "a blank inches box is 0");
  assert.equal(totalInches("", "10"), null, "no feet is no height");
  // The stored answer is the same number the application's build cell reads.
  assert.deepEqual(prefillFromInterview({ height_in: totalInches("5", "10") }), [{ key: "insured.height_in", value: 70 }]);
  const input = read("../../components/app/applications/workspace/interview/question-input.tsx");
  assert.match(input, /if \(isHeightQuestion\(q\.key, q\.type\)\) return <HeightAnswer/);
});

test("2 · the Quote step starts from the coverage the lead asked for when the application has no face yet", () => {
  // The term-life lead form stores "Coverage wanted" in cents: $250,000 is 25,000,000¢.
  const asked = faceAmountCents({ coverage_wanted: 25_000_000 });
  assert.equal(asked, 25_000_000);
  assert.equal(faceAmountCents({ coverage_amount: 250000 }), 25_000_000, "a plain dollar figure is converted once");
  assert.deepEqual(initialFaceCents(undefined, asked), { cents: 25_000_000, fromLead: true });
  assert.deepEqual(initialFaceCents(1_000_000, asked), { cents: 1_000_000, fromLead: false }, "the application's own face wins");
  assert.deepEqual(initialFaceCents(null, null), { cents: null, fromLead: false });
  assert.match(read("./service.ts"), /requestedFaceCents: leadFaceCents\(leadValues, currencyKeys\)/);
  const step = read("../../components/app/applications/workspace/steps/quote-step.tsx");
  assert.match(step, /initialFaceCents\(attempt\.values\["cov\.face_amount"\]\?\.value, caseView\.requestedFaceCents\)/);
});

test("3 · a blank Social Security number is not listed as a passed check", () => {
  const blank = { ...FIXTURE_ATTEMPT, values: { ...FIXTURE_ATTEMPT.values } };
  delete blank.values["insured.ssn"];
  const qa = runQa({ caseId: FIXTURE_CASE.caseId, attempt: blank });
  assert.ok(!qa.passed.includes("Social Security number valid"));
  assert.ok(qa.blocking.some((i) => i.code === "QA_REQUIRED_FIELD" && i.fieldKey === "insured.ssn"), "a required blank SSN is raised as missing");
  const notRequired = runQa({ caseId: FIXTURE_CASE.caseId, attempt: { ...blank, requiredKeys: blank.requiredKeys.filter((k) => k !== "insured.ssn") } });
  assert.ok(!notRequired.passed.includes("Social Security number valid"), "not required and blank: not done, never passed");
  // With a number on file the check runs and passes.
  assert.ok(runQa({ caseId: FIXTURE_CASE.caseId, attempt: FIXTURE_ATTEMPT }).passed.includes("Social Security number valid"));
  // The same rule for the other format checks: a blank ZIP is not "ZIP valid".
  const noZip = { ...blank, values: { ...blank.values } };
  delete noZip.values["addr.zip"];
  assert.ok(!runQa({ caseId: FIXTURE_CASE.caseId, attempt: noZip }).passed.includes("ZIP valid"));
});

test("4 · product labels are Title Case wherever a product code is spelled out", () => {
  assert.equal(productLineLabel("term_life"), "Term Life");
  assert.equal(productLineLabel("final_expense"), "Final Expense");
  assert.equal(PRODUCT_LABEL.term_life, "Term Life");
});

test("a partner lead's currency coverage is already cents: $300,000 stays $300,000 (manager walk 2026-11-20)", async () => {
  const { leadFaceCents } = await import("./quoteFace.ts");
  const partner = { coverage_amount: 30_000_000 };
  assert.equal(leadFaceCents(partner, new Set(["coverage_amount"])), 30_000_000, "the form types it currency: cents");
  assert.equal(leadFaceCents({ coverage_amount: 300_000 }, new Set()), 30_000_000, "an imported column with no form type is whole dollars");
  assert.equal(leadFaceCents({ face_amount_cents: 25_000_000 }, new Set()), 25_000_000);
  assert.equal(leadFaceCents({}, new Set(["coverage_amount"])), null);
  const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(service, /requestedFaceCents: leadFaceCents\(leadValues, currencyKeys\)/);
  assert.match(service, /from\("tenant_template_fields"\)\.select\("field_key"\)\.eq\("tenant_template_id", leadTemplateId\)\.eq\("type", "currency"\)/);
});
