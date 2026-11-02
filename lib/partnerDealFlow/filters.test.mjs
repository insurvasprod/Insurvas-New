import test from "node:test";
import assert from "node:assert/strict";

import { matchesPartnerDealFlowFilters, NO_CARRIER_FILTER } from "./filters.ts";

const row = {
  leadId: "lead-1",
  day: "2026-11-02",
  customer: "Dana Whitfield",
  productLine: "final_expense",
  stageName: "Contacted",
  stageType: "open",
  carrier: "Northstar Life",
  productType: "Final expense",
  monthlyPremiumCents: 8500,
  faceAmountCents: 5000000,
  draftDate: "2026-11-01",
  outcome: "Connected",
  submittedBy: { id: "member-1", name: "Rion Test" },
  submittedDay: "2026-10-29",
  updatedAt: "2026-11-02T10:00:00.000Z",
};

test("customer, carrier, and draft date filters match their own table fields", () => {
  assert.equal(matchesPartnerDealFlowFilters(row, { customer: "dana" }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { customer: "sam" }), false);
  assert.equal(matchesPartnerDealFlowFilters(row, { carrier: "Northstar Life" }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { carrier: "Other carrier" }), false);
  assert.equal(matchesPartnerDealFlowFilters(row, { draftDateFrom: "2026-11-01", draftDateTo: "2026-11-03" }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { draftDateFrom: "2026-11-02" }), false);
});

test("carrier filter can select rows without a recorded carrier", () => {
  assert.equal(matchesPartnerDealFlowFilters({ ...row, carrier: null }, { carrier: NO_CARRIER_FILTER }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { carrier: NO_CARRIER_FILTER }), false);
});

test("annualised premium range uses the displayed annual amount and excludes unpriced rows", () => {
  assert.equal(matchesPartnerDealFlowFilters(row, { annualisedPremiumMinCents: 100000 }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { annualisedPremiumMaxCents: 102000 }), true);
  assert.equal(matchesPartnerDealFlowFilters(row, { annualisedPremiumMaxCents: 101999 }), false);
  assert.equal(matchesPartnerDealFlowFilters({ ...row, monthlyPremiumCents: null }, { annualisedPremiumMinCents: 1 }), false);
});
