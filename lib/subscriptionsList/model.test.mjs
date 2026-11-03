// Run with: node --experimental-strip-types --test lib/subscriptionsList/model.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareRows,
  figuresFor,
  fullUtc,
  isEndingInPeriod,
  monthlyEquivalentFor,
  periodRange,
  queuedChange,
  toListRow,
} from "./model.ts";

const NOW = new Date("2026-09-24T12:00:00Z");

function sub(overrides = {}) {
  return {
    id: "s1",
    tenant_id: "t1",
    tenant_name: "Northline",
    plan_id: "p-growth-4",
    plan_code: "growth",
    plan_name: "Growth",
    plan_version: 4,
    pending_plan_id: null,
    pending_plan_name: null,
    pending_plan_version: null,
    status: "active",
    billing_cycle: "monthly",
    trial_ends_at: null,
    current_period_start: "2026-09-12T00:00:00Z",
    current_period_end: "2026-10-12T00:00:00Z",
    cancel_at_period_end: false,
    cancel_reason: null,
    cancelled_at: null,
    started_at: "2026-08-12T00:00:00Z",
    ...overrides,
  };
}

const PRICES = [
  { plan_id: "p-growth-4", price_monthly_cents: 9900, price_quarterly_cents: 27000, price_yearly_cents: 99000 },
  { plan_id: "p-scale-2", price_monthly_cents: 24900, price_quarterly_cents: null, price_yearly_cents: 249000 },
];

test("monthly equivalent mirrors monthly_equivalent_cents", () => {
  assert.equal(monthlyEquivalentFor(PRICES[0], "monthly"), 9900);
  assert.equal(monthlyEquivalentFor(PRICES[0], "quarterly"), 9000);
  assert.equal(monthlyEquivalentFor(PRICES[0], "yearly"), 8250);
  assert.equal(monthlyEquivalentFor(PRICES[1], "quarterly"), 0, "an unpriced cycle is 0, as the SQL coalesces");
  assert.equal(monthlyEquivalentFor(undefined, "monthly"), 0);
});

test("period range prints the last covered day, as the tenant record does", () => {
  assert.equal(periodRange("2026-09-12T00:00:00Z", "2026-10-12T00:00:00Z", NOW), "12 Sep – 11 Oct");
  assert.equal(periodRange("2025-11-22T00:00:00Z", "2026-11-22T00:00:00Z", NOW), "22 Nov 2025 – 21 Nov");
  assert.equal(periodRange(null, null, NOW), "—");
  assert.equal(fullUtc("2026-09-22T08:40:55Z"), "22 Sep 2026 08:40:55 UTC");
});

test("queued change: ending wins over a queued plan; trials never claim to convert", () => {
  assert.deepEqual(queuedChange(sub({ status: "cancelling", cancel_at_period_end: true, pending_plan_id: "x" }), NOW), {
    kind: "ends",
    text: "Ends 12 Oct 2026",
  });
  assert.deepEqual(queuedChange(sub({ pending_plan_id: "p-scale-2", pending_plan_name: "Scale", pending_plan_version: 2 }), NOW), {
    kind: "plan",
    text: "Scale v2 at renewal",
  });
  assert.equal(queuedChange(sub({ status: "trialing", trial_ends_at: "2026-09-29T00:00:00Z" }), NOW).text, "Trial ends 29 Sep");
  assert.equal(queuedChange(sub({ status: "trialing", trial_ends_at: "2026-09-20T00:00:00Z" }), NOW).text, "Trial ended 20 Sep");
  assert.equal(queuedChange(sub({ status: "cancelled", cancelled_at: "2026-09-04T10:00:00Z" }), NOW).text, "Ended 4 Sep 2026");
  assert.equal(queuedChange(sub(), NOW).text, "—");
});

test("cancelled-in-period reads either marker, never an expired row", () => {
  assert.equal(isEndingInPeriod(sub({ status: "cancelling" })), true);
  assert.equal(isEndingInPeriod(sub({ cancel_at_period_end: true })), true);
  assert.equal(isEndingInPeriod(sub({ status: "cancelled", cancel_at_period_end: true })), false);
});

test("order: soonest boundary first, no boundary next, expired last and newest-ended first", () => {
  const rows = [
    sub({ id: "exp-old", status: "cancelled", cancelled_at: "2026-08-01T00:00:00Z" }),
    sub({ id: "late", current_period_end: "2026-11-01T00:00:00Z" }),
    sub({ id: "none", current_period_end: null }),
    sub({ id: "trial", status: "trialing", trial_ends_at: "2026-09-26T00:00:00Z" }),
    sub({ id: "exp-new", status: "cancelled", cancelled_at: "2026-09-20T00:00:00Z" }),
    sub({ id: "soon" }),
  ];
  assert.deepEqual(
    [...rows].sort(compareRows).map((r) => r.id),
    ["trial", "soon", "late", "none", "exp-new", "exp-old"],
  );
});

test("figures count from the rows; MRR is null, never 0, when prices are missing", () => {
  const rows = [
    sub({ id: "a" }),
    sub({ id: "b", plan_id: "p-scale-2", plan_code: "scale", billing_cycle: "yearly" }),
    sub({ id: "c", plan_id: "p-growth-3", plan_code: "growth" }),
    sub({ id: "t1", status: "trialing", trial_ends_at: "2026-09-28T00:00:00Z" }),
    sub({ id: "t2", status: "trialing", trial_ends_at: "2026-10-20T00:00:00Z" }),
    sub({ id: "x", status: "cancelling", cancel_at_period_end: true }),
    sub({ id: "pd", status: "past_due" }),
    sub({ id: "q", status: "paused", pending_plan_id: "p-scale-2" }),
    sub({ id: "e", status: "cancelled", pending_plan_id: "p-scale-2" }),
  ];
  const f = figuresFor(rows, PRICES, NOW);
  assert.equal(f.active, 3);
  assert.equal(f.activePlans, 2, "growth v3 and v4 are one plan");
  assert.equal(f.trialling, 2);
  assert.equal(f.trialsEndingThisWeek, 1);
  assert.equal(f.endingInPeriod, 1);
  assert.equal(f.queuedPlanChanges, 1, "an expired row's stale pending plan is not queued");
  // a 9900 + b 20750 + c 0 (no price row) + x 9900 + pd 9900; trials and paused are not revenue.
  assert.equal(f.mrrCents, 9900 + 20750 + 9900 + 9900);
  assert.equal(figuresFor(rows, null, NOW).mrrCents, null);
});

test("display row carries server-formatted text", () => {
  const row = toListRow(sub({ cancel_reason: "Too expensive" }), new Map(PRICES.map((p) => [p.plan_id, p])), NOW);
  assert.equal(row.periodText, "12 Sep – 11 Oct");
  assert.equal(row.monthlyCents, 9900);
  assert.equal(row.countsTowardMrr, true);
  assert.equal(row.cancelReason, "Too expensive");
  assert.equal(toListRow(sub(), null, NOW).monthlyCents, null);
});
