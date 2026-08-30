// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeChurn, safeRate, formatRate, unexplainedMovementCents, trialConversionRate,
} from "./churn.ts";

const EMPTY = {
  customersAtStart: 0, customersChurned: 0, mrrAtStart: 0,
  churnedMrrCents: 0, expansionMrrCents: 0, contractionMrrCents: 0,
};

test("a month with zero churn shows 0%, not a division-by-zero error", () => {
  // The ticket's criterion, and the state this dashboard is in on day one.
  const churn = computeChurn(EMPTY);

  assert.equal(churn.logoChurnRate, 0);
  assert.equal(churn.netRevenueChurnRate, 0);
  assert.equal(Number.isNaN(churn.logoChurnRate), false);
  assert.equal(Number.isFinite(churn.netRevenueChurnRate), true);
});

test("logo churn is customers lost over customers at start", () => {
  const churn = computeChurn({ ...EMPTY, customersAtStart: 40, customersChurned: 2 });

  assert.equal(churn.logoChurnRate, 0.05);
  assert.equal(formatRate(churn.logoChurnRate), "5.0%");
});

test("net revenue churn can be NEGATIVE, and that is the good case", () => {
  // Expansion outran churn: the existing book grew. Clamping this at zero would hide the single
  // best thing a subscription business can be doing.
  const churn = computeChurn({
    ...EMPTY, mrrAtStart: 100_000, churnedMrrCents: 5_000, expansionMrrCents: 12_000,
  });

  assert.ok(churn.netRevenueChurnRate < 0, `expected negative, got ${churn.netRevenueChurnRate}`);
  assert.equal(churn.netRevenueChurnRate, -0.07);
});

test("gross revenue churn ignores expansion and never goes negative", () => {
  const churn = computeChurn({
    ...EMPTY, mrrAtStart: 100_000, churnedMrrCents: 5_000, expansionMrrCents: 12_000,
  });

  assert.equal(churn.grossRevenueChurnRate, 0.05);
  assert.ok(churn.grossRevenueChurnRate >= 0);
});

test("contraction counts as churn, expansion offsets it", () => {
  const churn = computeChurn({
    ...EMPTY, mrrAtStart: 100_000, churnedMrrCents: 3_000, contractionMrrCents: 2_000,
    expansionMrrCents: 1_000,
  });

  assert.equal(churn.grossRevenueChurnRate, 0.05);
  assert.equal(churn.netRevenueChurnRate, 0.04);
});

test("safeRate returns 0 for a zero denominator, never NaN or Infinity", () => {
  assert.equal(safeRate(5, 0), 0);
  assert.equal(safeRate(0, 0), 0);
  assert.equal(Number.isFinite(safeRate(100, 0)), true);
});

test("total churn of everything is 100%, not an error", () => {
  const churn = computeChurn({
    ...EMPTY, customersAtStart: 3, customersChurned: 3, mrrAtStart: 50_000, churnedMrrCents: 50_000,
  });

  assert.equal(formatRate(churn.logoChurnRate), "100.0%");
  assert.equal(formatRate(churn.netRevenueChurnRate), "100.0%");
});

test("the movement waterfall must add up, and reports the gap when it does not", () => {
  const balanced = unexplainedMovementCents({
    openingCents: 100_000, newCents: 20_000, expansionCents: 5_000,
    contractionCents: 2_000, churnedCents: 3_000, closingCents: 120_000,
  });
  assert.equal(balanced, 0);

  // Today expansion and contraction are never recorded, so a real month WILL show a gap. Surfacing
  // its size is the point — a waterfall that silently does not add up is worse than no waterfall.
  const unexplained = unexplainedMovementCents({
    openingCents: 100_000, newCents: 0, expansionCents: 0,
    contractionCents: 0, churnedCents: 0, closingCents: 112_000,
  });
  assert.equal(unexplained, 12_000);
});

test("trial conversion with no trials is 0%, not an error", () => {
  assert.equal(trialConversionRate({ trialsStarted: 0, trialsConverted: 0 }), 0);
  assert.equal(trialConversionRate({ trialsStarted: 8, trialsConverted: 2 }), 0.25);
});
