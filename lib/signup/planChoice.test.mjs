import assert from "node:assert/strict";
import test from "node:test";

import { agencyPlanForSeats, checkPlanChoice, choiceTotalCents, withSeatBands } from "./planChoice.ts";

const cents = (monthly, yearly = null) => ({ monthly, quarterly: null, yearly });
const plans = withSeatBands([
  { code: "basic", name: "Basic", blurb: null, audience: "individual", cents: cents(24900, 249000), trialDays: 14, maxSeats: 1, featureKeys: [], addons: [] },
  { code: "agency_unlimited", name: "Agency · 151+ seats", blurb: null, audience: "agency", cents: cents(499900), trialDays: 14, maxSeats: null, featureKeys: [], addons: [] },
  { code: "agency_50", name: "Agency · 1–50 seats", blurb: null, audience: "agency", cents: cents(99900), trialDays: 14, maxSeats: 50, featureKeys: [],
    addons: [{ code: "team_access", name: "Custom team access", description: null, priceCents: 19900, cycle: "monthly" }, { code: "yearly_only", name: "Y", description: null, priceCents: 100, cycle: "yearly" }] },
  { code: "agency_150", name: "Agency · 51–150 seats", blurb: null, audience: "agency", cents: cents(249900), trialDays: 14, maxSeats: 150, featureKeys: [], addons: [] },
]);

test("agency bands take their floor from the band below; a one-agent plan is one seat", () => {
  const band = (code) => plans.find((plan) => plan.code === code);
  assert.deepEqual([band("agency_50").minSeats, band("agency_150").minSeats, band("agency_unlimited").minSeats], [1, 51, 151]);
  assert.deepEqual([band("basic").minSeats, band("basic").maxSeats], [1, 1]);
  assert.equal(agencyPlanForSeats(plans, 50).code, "agency_50");
  assert.equal(agencyPlanForSeats(plans, 51).code, "agency_150");
  assert.equal(agencyPlanForSeats(plans, 900).code, "agency_unlimited");
});

test("the total is the plan plus the add-ons picked on the same cycle", () => {
  const agency = plans.find((plan) => plan.code === "agency_50");
  assert.equal(choiceTotalCents(agency, "monthly", []), 99900);
  assert.equal(choiceTotalCents(agency, "monthly", ["team_access", "yearly_only"]), 119800);
  assert.equal(choiceTotalCents(agency, "yearly", []), null);
});

test("the server refuses seats outside the band, unsold cycles and add-ons the plan does not offer", () => {
  assert.equal(checkPlanChoice(plans, { planCode: "agency_50", billingCycle: "monthly", seats: 24, addonCodes: ["team_access"] }).ok, true);
  assert.match(checkPlanChoice(plans, { planCode: "agency_50", billingCycle: "monthly", seats: 60, addonCodes: [] }).error, /1–50 seats/);
  assert.match(checkPlanChoice(plans, { planCode: "agency_unlimited", billingCycle: "monthly", seats: 20, addonCodes: [] }).error, /starts at 151/);
  assert.match(checkPlanChoice(plans, { planCode: "agency_50", billingCycle: "yearly", seats: 5, addonCodes: [] }).error, /not sold/);
  assert.match(checkPlanChoice(plans, { planCode: "agency_50", billingCycle: "monthly", seats: 5, addonCodes: ["yearly_only"] }).error, /not offered/);
  const solo = checkPlanChoice(plans, { planCode: "basic", billingCycle: "yearly", seats: 40, addonCodes: [] });
  assert.equal(solo.ok && solo.seats, 1);
  assert.match(checkPlanChoice(plans, { planCode: "gone", billingCycle: "monthly", seats: 1, addonCodes: [] }).error, /no longer available/);
});
