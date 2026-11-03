import assert from "node:assert/strict";
import test from "node:test";

import { buildInsights, productBreakdown, weekdayCounts, whereLeadsAre } from "./insights.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86_400_000;

function lead(over = {}) {
  return {
    id: "1", workItemId: "w1", customer: "A", product: "Final Expense", language: null,
    stageId: "s", stageName: "New", stageType: "open", disposition: null, outcome: null,
    submittedBy: { id: "u1", name: "Rion" }, status: "unclaimed",
    submittedAt: new Date(NOW - DAY).toISOString(), updatedAt: new Date(NOW - DAY).toISOString(),
    ...over,
  };
}
const sold = (over = {}) => lead({ status: "completed", disposition: "sold", ...over });

test("a lead nobody claimed for over two days is the first thing to act on", () => {
  const rows = [lead({ submittedAt: new Date(NOW - 3 * DAY).toISOString() }), lead({ id: "2" })];
  const insights = buildInsights(rows, NOW);
  assert.equal(insights[0].key, "unclaimed");
  assert.match(insights[0].text, /^1 lead has waited over 2 days/);
});

test("a claimed lead that has not moved in a week is stalled", () => {
  const rows = [lead({ status: "claimed", updatedAt: new Date(NOW - 9 * DAY).toISOString() })];
  assert.ok(buildInsights(rows, NOW).some((item) => item.key === "stalled"));
});

test("conversion by product needs a sample before it speaks", () => {
  const few = [sold(), lead({ id: "2" })];
  assert.deepEqual(productBreakdown(few).map((line) => line.conversion), [null]);
  assert.ok(buildInsights(few, NOW).some((item) => item.key === "product-sample"));
});

test("a product far under the team rate is flagged, and the best one is named", () => {
  const weak = Array.from({ length: 6 }, (_, i) => lead({ id: `w${i}`, product: "Term Life", status: "completed" }));
  const strong = Array.from({ length: 6 }, (_, i) => sold({ id: `s${i}`, product: "Final Expense" }));
  const keys = buildInsights([...weak, ...strong], NOW).map((item) => item.key);
  assert.ok(keys.includes("product-low"));
  assert.ok(keys.includes("product-high"));
});

test("where the leads are now adds up to the period's leads", () => {
  const rows = [lead(), lead({ id: "2", status: "claimed" }), sold({ id: "3" }), lead({ id: "4", status: "completed" })];
  const where = whereLeadsAre(rows);
  assert.deepEqual(where, { waiting: 1, inProgress: 1, closed: 1, applications: 1 });
});

test("weekdays run Monday first", () => {
  const monday = new Date(2026, 10, 2, 10).toISOString();
  assert.equal(weekdayCounts([lead({ submittedAt: monday })])[0], 1);
});

test("a top submitter and a busy weekday are named only past the pattern sample", () => {
  const monday = new Date(2026, 10, 2, 10).toISOString();
  const rows = Array.from({ length: 8 }, (_, i) => lead({ id: `m${i}`, submittedAt: monday, submittedBy: { id: i < 6 ? "a" : "b", name: i < 6 ? "Rion" : "Maya" }, status: "completed" }));
  const keys = buildInsights(rows, NOW).map((item) => item.key);
  assert.ok(keys.includes("weekday"));
  assert.ok(keys.includes("submitter"));
  assert.ok(!buildInsights(rows.slice(0, 3), NOW).some((item) => item.key === "weekday"));
});
