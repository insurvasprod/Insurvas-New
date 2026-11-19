import test from "node:test";
import assert from "node:assert/strict";

import { csvCell, filterSubs, lensCounts, readSubsFilters, subsFilterParams } from "./filters.ts";
import { renewsWithin } from "./model.ts";

const row = (over) => ({
  id: "s1", tenantId: "t1", tenantName: "Ellery & Fields", planId: "p1", planName: "Agency", planVersion: 1, cycle: "monthly",
  status: "active", queuedKind: "none", queuedText: "—", periodText: "", periodFull: "", periodStart: null, periodEnd: null,
  startedAt: "2026-01-01T00:00:00Z", startedFull: "", trialEndsAt: null, trialEndsFull: null, cancelledAt: null, cancelledFull: null,
  cancelReason: null, pendingPlanLabel: null, monthlyCents: 29900, cycleCents: 29900, countsTowardMrr: true, renewsWithinWeek: false, cancelAtPeriodEnd: false,
  ...over,
});

test("?status=past_due is read from the address (the dashboard's link)", () => {
  const filters = readSubsFilters({ status: "past_due" });
  assert.equal(filters.status, "past_due");
  const rows = [row({ id: "a" }), row({ id: "b", status: "past_due" })];
  assert.deepEqual(filterSubs(rows, filters).map((r) => r.id), ["b"]);
});

test("unknown values fall back to not filtered, and defaults leave the address", () => {
  const filters = readSubsFilters(new URLSearchParams("status=nope&cycle=weekly&lens=x&q=%20Blair%20"));
  assert.deepEqual(filters, { lens: "all", q: "Blair", plan: "all", status: "all", cycle: "any", queued: "any" });
  assert.deepEqual(subsFilterParams(filters), { lens: null, q: "Blair", plan: null, status: null, cycle: null, queued: null });
});

test("lenses count past due, cancelling, queued changes and renewals", () => {
  const rows = [
    row({ id: "a", renewsWithinWeek: true }),
    row({ id: "b", status: "past_due" }),
    row({ id: "c", status: "cancelling" }),
    row({ id: "d", cancelAtPeriodEnd: true }),
    row({ id: "e", queuedKind: "plan" }),
    row({ id: "f", status: "cancelled", cancelAtPeriodEnd: true }),
  ];
  assert.deepEqual(lensCounts(rows), { all: 6, past_due: 1, cancelling: 2, queued: 1, renews: 1 });
});

test("renews within 7 days: active, not ending, period ends in the window", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  const sub = { status: "active", cancel_at_period_end: false, current_period_end: "2026-11-20T00:00:00Z" };
  assert.equal(renewsWithin(sub, now), true);
  assert.equal(renewsWithin({ ...sub, current_period_end: "2026-11-30T00:00:00Z" }, now), false);
  assert.equal(renewsWithin({ ...sub, cancel_at_period_end: true }, now), false);
  assert.equal(renewsWithin({ ...sub, status: "trialing" }, now), false);
});

test("CSV cells are quoted and defused", () => {
  assert.equal(csvCell("Ellery, Fields"), '"Ellery, Fields"');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell(null), "");
});
