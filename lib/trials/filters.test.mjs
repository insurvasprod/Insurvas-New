import test from "node:test";
import assert from "node:assert/strict";

import { filterTrials, readTrialFilters, trialFilterParams } from "./filters.ts";
import { monthlyOutcomes } from "./boardModel.ts";

const row = (over) => ({
  subscriptionId: "s", tenantId: "t", displayName: "Rowan Test Insurance", tenantName: "Rowan", planName: "Agency",
  ownerEmail: "owner@example.test", ownerName: "Rowan", daysLeft: 2, hasPaymentMethod: false,
  signals: { leads: true, team: false, carrier: false }, ...over,
});

test("the workspace's link lands filtered: ends within a week, no card", () => {
  const filters = readTrialFilters(new URLSearchParams("ends=week&card=no_card"));
  assert.deepEqual(filters, { q: "", plan: "all", ends: "week", signal: "any", card: "no_card" });
  const rows = [row({ subscriptionId: "a" }), row({ subscriptionId: "b", daysLeft: 9 }), row({ subscriptionId: "c", hasPaymentMethod: true })];
  assert.deepEqual(filterTrials(rows, filters, 3).map((r) => r.subscriptionId), ["a"]);
});

test("unknown values are ignored and defaults leave the address", () => {
  const filters = readTrialFilters({ ends: "month", card: "maybe", q: "  owner@ " });
  assert.deepEqual(trialFilterParams(filters), { q: "owner@", plan: null, ends: null, signal: null, card: null });
});

test("activation filters need the signals; unknown signals match none", () => {
  const filters = readTrialFilters({ signal: "neither" });
  assert.equal(filterTrials([row({ signals: { leads: false, team: false, carrier: true } })], filters, 3).length, 1);
  assert.equal(filterTrials([row({ signals: null })], filters, 3).length, 0);
});

test("conversion over six months: each ended trial in its month", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const trials = [
    { status: "active", started_at: "2026-10-01T00:00:00Z", trial_ends_at: "2026-10-15T00:00:00Z", cancelled_at: null, first_paid_at: "2026-10-15T01:00:00Z" },
    { status: "cancelled", started_at: "2026-10-20T00:00:00Z", trial_ends_at: "2026-11-03T00:00:00Z", cancelled_at: "2026-11-03T00:00:00Z", first_paid_at: null },
    { status: "active", started_at: "2025-01-01T00:00:00Z", trial_ends_at: "2025-01-15T00:00:00Z", cancelled_at: null, first_paid_at: "2025-01-15T00:00:00Z" },
    { status: "trialing", started_at: "2026-11-10T00:00:00Z", trial_ends_at: "2026-11-24T00:00:00Z", cancelled_at: null, first_paid_at: null },
  ];
  const months = monthlyOutcomes(trials, now, 6);
  assert.deepEqual(months.map((m) => m.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(months.slice(4).map((m) => [m.label, m.converted, m.lapsed]), [["Oct", 1, 0], ["Nov", 0, 1]]);
});
