// Run with: node --experimental-strip-types --test lib/dashboard/views/sales.test.mjs
//
// The Overview's "My recent business" and today's quotes and sales (owner 2026-11-06, round 2 screen 1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, gaugeMax, recentBusiness, salesAverage, salesToday, versusAverage } from "./sales.ts";

const NOW = Date.parse("2026-11-06T18:00:00Z");
const ZONE = "America/New_York";
const row = (caseId, updatedAt, extra = {}) => ({ caseId, applicationId: `${caseId}-a`, clientName: caseId, carrierName: null, productLabel: null, status: "submitted", outcome: null, monthlyPremiumCents: 5000, updatedAt, ...extra });

test("recent business: last seven days, newest first, one row per case", () => {
  const rows = [
    row("old", "2026-10-20T10:00:00Z"),
    row("a", "2026-11-05T10:00:00Z"),
    row("b", "2026-11-06T10:00:00Z"),
    row("a", "2026-11-04T10:00:00Z", { applicationId: "a-older" }),
  ];
  const out = recentBusiness(rows, NOW);
  assert.deepEqual(out.map((r) => r.applicationId), ["b-a", "a-a"]);
});

test("recent business keeps to its limit", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`c${i}`, new Date(NOW - i * 3600_000).toISOString()));
  assert.equal(recentBusiness(rows, NOW, 7, 5).length, 5);
});

test("today's quotes and sales are counted in the workspace's zone", () => {
  // 02:00Z on the 7th is still the 6th in New York.
  const apps = [row("x", "2026-11-06T12:00:00Z", { submittedAt: "2026-11-07T02:00:00Z" }), row("y", "2026-11-05T12:00:00Z", { submittedAt: "2026-11-05T15:00:00Z" })];
  const quotes = [{ createdAt: "2026-11-06T14:00:00Z", outcome: "presented" }, { createdAt: "2026-11-06T15:00:00Z", outcome: "discarded" }, { createdAt: "2026-11-05T15:00:00Z", outcome: "selected" }];
  assert.deepEqual(salesToday(apps, quotes, Date.parse("2026-11-07T03:00:00Z"), ZONE), { quotes: 1, sales: 1 });
  assert.equal(dayKey("2026-11-07T02:00:00Z", ZONE), "2026-11-06");
});

test("the gauge tops out at the fortnight's best day, never under today", () => {
  assert.equal(gaugeMax([{ dials: 40 }, { dials: null }, { dials: 120 }], 58), 120);
  assert.equal(gaugeMax([{ dials: 10 }], 58), 58);
  assert.equal(gaugeMax([], 0), 1);
});

test("the sales average counts the fortnight before today, and the chip says where today stands", () => {
  const apps = [
    row("t", "2026-11-06T15:00:00Z", { submittedAt: "2026-11-06T15:00:00Z" }),
    row("a", "2026-11-01T15:00:00Z", { submittedAt: "2026-11-01T15:00:00Z" }),
    row("b", "2026-10-30T15:00:00Z", { submittedAt: "2026-10-30T15:00:00Z" }),
    row("old", "2026-10-01T15:00:00Z", { submittedAt: "2026-10-01T15:00:00Z" }),
  ];
  assert.equal(salesAverage(apps, NOW, ZONE), 2 / 14);
  assert.deepEqual(versusAverage(1, 2 / 14), { text: "+1 sale vs your average", ahead: true });
  assert.deepEqual(versusAverage(0, 2), { text: "2 sales under your average", ahead: false });
  assert.equal(versusAverage(1, 1.2), null);
});
