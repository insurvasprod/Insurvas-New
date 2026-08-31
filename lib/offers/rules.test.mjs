// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { autoOfferIsEligible, manualOfferWarning, offerEligibilityFailures } from "./rules.ts";

const base = {
  startsAt: null,
  endsAt: null,
  eligiblePlanTypes: [],
  eligiblePlanIds: [],
  newCustomersOnly: false,
  existingCustomersOnly: false,
  eligibleCycles: [],
};
const individualMonthly = { planType: "individual", planId: "plan-1", billingCycle: "monthly", isNewCustomer: true };

test("optional rules combine with AND", () => {
  const rules = {
    ...base,
    eligiblePlanTypes: ["individual"],
    eligiblePlanIds: ["plan-1"],
    eligibleCycles: ["monthly"],
    newCustomersOnly: true,
  };
  assert.equal(autoOfferIsEligible(true, rules, individualMonthly), true);
  assert.equal(autoOfferIsEligible(true, rules, { ...individualMonthly, planId: "plan-2" }), false);
  assert.equal(autoOfferIsEligible(true, rules, { ...individualMonthly, billingCycle: "yearly" }), false);
  assert.equal(autoOfferIsEligible(true, rules, { ...individualMonthly, isNewCustomer: false }), false);
});

test("plan type mismatch is never silent on the manual path", () => {
  const rules = { ...base, eligiblePlanTypes: ["individual"] };
  const agency = { ...individualMonthly, planType: "agency_no_teams" };
  assert.match(manualOfferWarning(rules, agency), /Confirm/i);
  assert.deepEqual(offerEligibilityFailures(rules, agency), ["This offer is limited to individual plan types."]);
});

test("manual warning is absent for an allowed plan type", () => {
  assert.equal(manualOfferWarning({ ...base, eligiblePlanTypes: ["individual"] }, individualMonthly), null);
});

test("auto apply window is start-inclusive and end-exclusive", () => {
  const rules = { ...base, startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(autoOfferIsEligible(true, rules, individualMonthly, new Date("2026-09-01T00:00:00.000Z")), true);
  assert.equal(autoOfferIsEligible(true, rules, individualMonthly, new Date("2026-10-01T00:00:00.000Z")), false);
});
