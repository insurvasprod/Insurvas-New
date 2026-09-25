import assert from "node:assert/strict";
import test from "node:test";

import { upgradePathFor } from "./upgradePath.ts";

const plan = (code, sortOrder, features, maxSeats = 5) => ({ code, name: code[0].toUpperCase() + code.slice(1), sortOrder, features: new Set(features), maxSeats });
const catalogue = [
  plan("scale", 3, ["ledger", "statements", "discrepancies", "payouts"], 25),
  plan("starter", 1, ["ledger"], 3),
  plan("growth", 2, ["ledger", "dialer"], 12),
];

test("the first plan above the current one that grants the feature, and what it adds", () => {
  const path = upgradePathFor(catalogue, "statements", "growth");
  assert.equal(path.plan.code, "scale");
  assert.equal(path.plan.maxSeats, 25);
  assert.deepEqual(path.adds, ["statements", "discrepancies", "payouts"]);
});

test("the gated feature leads the list of what the upgrade adds", () => {
  assert.equal(upgradePathFor(catalogue, "payouts", "starter").adds[0], "payouts");
});

test("a cheaper plan that has the feature is never offered as the upgrade", () => {
  const withCheap = [...catalogue, plan("basic", 0, ["dialer"])];
  assert.equal(upgradePathFor(withCheap, "dialer", "scale"), null);
});

test("no public plan with the feature means no upgrade to offer", () => {
  assert.equal(upgradePathFor(catalogue, "telepathy", "starter"), null);
});

test("an account without a plan starts from the bottom of the catalogue", () => {
  assert.equal(upgradePathFor(catalogue, "dialer", null).plan.code, "growth");
});
