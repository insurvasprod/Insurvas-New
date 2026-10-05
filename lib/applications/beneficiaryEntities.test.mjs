// LA-3.8 / 3.9 rules the workspace's Beneficiaries and Payment steps lean on.
import test from "node:test";
import assert from "node:assert/strict";

const { checkBeneficiaries, isEntityRelationship } = await import("./beneficiaries.ts");
const { recommendDraftDay, isSafeDraftDay } = await import("../draftDates/optimiser.ts");

const row = (over) => ({ id: "1", tier: "primary", first_name: "Ada", last_name: "Oyelaran", relationship: "child", share_bp: 10_000, ...over });

test("3.8: an estate, trust or funeral home needs one name and no first name; a person needs both", () => {
  for (const relationship of ["estate", "trust", "funeral_home"]) {
    assert.ok(isEntityRelationship(relationship));
    const issues = checkBeneficiaries([row({ relationship, first_name: "", last_name: "The estate of Grace Oyelaran" })]);
    assert.ok(!issues.some((i) => i.code === "BENEFICIARY_NAME"), `${relationship} with no first name is complete`);
    const unnamed = checkBeneficiaries([row({ relationship, first_name: "", last_name: "" })]);
    assert.ok(unnamed.some((i) => i.code === "BENEFICIARY_NAME" && i.severity === "block"), `${relationship} with no name blocks`);
  }
  assert.ok(!isEntityRelationship("child"));
  const person = checkBeneficiaries([row({ first_name: "" })]);
  assert.ok(person.some((i) => i.code === "BENEFICIARY_NAME" && i.severity === "block"));
});

test("3.8: \"other\" needs words; the estate warns and still does not block", () => {
  assert.ok(checkBeneficiaries([row({ relationship: "other" })]).some((i) => i.code === "BENEFICIARY_RELATIONSHIP_OTHER" && i.severity === "block"));
  assert.ok(!checkBeneficiaries([row({ relationship: "other", relationship_other: "Godson" })]).some((i) => i.severity === "block"));
  const estate = checkBeneficiaries([row({ relationship: "estate", first_name: "", last_name: "The estate of Ada" })]);
  assert.ok(estate.some((i) => i.code === "BENEFICIARY_ESTATE" && i.severity === "warn"));
  assert.ok(!estate.some((i) => i.severity === "block"));
});

test("3.9: the tenant buffer moves the recommendation, and every alternate is a safe day", () => {
  const from = new Date("2026-09-15T00:00:00Z");
  const two = recommendDraftDay({ incomeType: "ssa", birthDay: 15, buffer: 2, from });
  const four = recommendDraftDay({ incomeType: "ssa", birthDay: 15, buffer: 4, from });
  assert.equal(two.kind, "recommended");
  assert.equal(four.kind, "recommended");
  assert.ok(four.recommended.day > two.recommended.day, "a longer buffer drafts later");
  for (const alt of two.alternates) assert.ok(isSafeDraftDay({ incomeType: "ssa", birthDay: 15, from }, alt.day), `the ${alt.day} is safe`);
  // A day before the latest third Wednesday is not safe in every month.
  assert.equal(isSafeDraftDay({ incomeType: "ssa", birthDay: 15, from }, 16), false);
});
