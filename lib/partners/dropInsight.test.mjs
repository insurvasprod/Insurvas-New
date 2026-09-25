import assert from "node:assert/strict";
import test from "node:test";

import { worstDropRate } from "./dropInsight.ts";

const partner = (over) => ({ id: over.name, status: "active", transfers_this_month: 0, completed_this_month: 0, dropped_this_month: 0, active_term: null, ...over });

test("picks the active partner with the highest drop rate and prices per-transfer drops", () => {
  const insight = worstDropRate([
    partner({ name: "Apex", transfers_this_month: 412, completed_this_month: 58, dropped_this_month: 9, active_term: { payout_model: "per_transfer", rate_cents: 2800 } }),
    partner({ name: "Northline", transfers_this_month: 193, completed_this_month: 7, dropped_this_month: 44, active_term: { payout_model: "per_transfer", rate_cents: 2800 } }),
  ]);
  assert.equal(insight.name, "Northline");
  assert.equal(Math.round(insight.dropRate * 100), 23);
  assert.equal(Math.round(insight.completedRate * 100), 4);
  assert.equal(insight.droppedCostCents, 44 * 2800);
});

test("ignores small samples, low rates, paused partners; no cost unless paid per transfer", () => {
  assert.equal(worstDropRate([partner({ name: "Tiny", transfers_this_month: 9, dropped_this_month: 9 })]), null);
  assert.equal(worstDropRate([partner({ name: "Fine", transfers_this_month: 100, dropped_this_month: 14 })]), null);
  assert.equal(worstDropRate([partner({ name: "Paused", status: "paused", transfers_this_month: 100, dropped_this_month: 50 })]), null);
  const share = worstDropRate([partner({ name: "Crest", transfers_this_month: 20, dropped_this_month: 5, active_term: { payout_model: "revenue_share", rate_cents: null } })]);
  assert.equal(share.droppedCostCents, null);
});
