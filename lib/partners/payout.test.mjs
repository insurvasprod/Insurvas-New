import test from "node:test";
import assert from "node:assert/strict";

import { expectedEarnings, expectedEarningsLabel, payoutLabel, termLabel } from "./payout.ts";

const perSale = { payoutModel: "per_sale", rateCents: 9000, ratePctBp: null };
const share = { payoutModel: "revenue_share", rateCents: null, ratePctBp: 1250 };

test("a term reads as the sentence the agent side already shows", () => {
  assert.equal(payoutLabel({ payout_model: "per_transfer", rate_cents: 9000, rate_pct_bp: null }), "$90.00 / transfer");
  assert.equal(payoutLabel({ payout_model: "per_issued_policy", rate_cents: 12500, rate_pct_bp: null }), "$125.00 / issued policy");
  assert.equal(payoutLabel({ payout_model: "revenue_share", rate_cents: null, rate_pct_bp: 1250 }), "12.5% revenue share");
  assert.equal(termLabel(perSale), "$90.00 / sale");
});

test("a term that says nothing a partner can read says nothing", () => {
  assert.equal(payoutLabel(null), null);
  assert.equal(payoutLabel({ payout_model: "per_sale", rate_cents: null, rate_pct_bp: null }), null);
  assert.equal(payoutLabel({ payout_model: "revenue_share", rate_cents: null, rate_pct_bp: null }), null);
  assert.equal(termLabel(null), null);
});

test("per-item models are arithmetic, so they can be answered", () => {
  assert.equal(expectedEarnings(4, perSale), 36_000);
  assert.equal(expectedEarnings(1, { payoutModel: "per_lead", rateCents: 2500, ratePctBp: null }), 2500);
});

test("a revenue share is never estimated", () => {
  // It depends on the agency's revenue per sale, which the partner cannot see.
  assert.equal(expectedEarnings(4, share), null);
  assert.equal(expectedEarningsLabel(4, share), "12.5% revenue share", "the rate still stands");
});

test("no term, no rate, or nothing converted yields no figure", () => {
  assert.equal(expectedEarnings(4, null), null);
  assert.equal(expectedEarnings(4, { payoutModel: "per_sale", rateCents: null, ratePctBp: null }), null);
  assert.equal(expectedEarnings(0, perSale), null, "zero converted is not a $0.00 figure to display");
  assert.equal(expectedEarnings(-1, perSale), null);
});

test("the line names the rate it multiplied, so the figure can be checked", () => {
  assert.equal(expectedEarningsLabel(4, perSale), "about $360.00 at $90.00 / sale");
  assert.equal(expectedEarningsLabel(0, perSale), "$90.00 / sale", "nothing converted still teaches the rate");
  assert.equal(expectedEarningsLabel(4, null), null);
});

test("a zero rate is a real rate and reads as one", () => {
  const free = { payoutModel: "per_lead", rateCents: 0, ratePctBp: null };
  assert.equal(termLabel(free), "$0.00 / lead");
  assert.equal(expectedEarnings(4, free), 0);
  assert.equal(expectedEarningsLabel(4, free), "about $0.00 at $0.00 / lead");
});
