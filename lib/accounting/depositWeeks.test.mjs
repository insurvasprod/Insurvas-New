// Cash this month (mobile board B6): the month's deposits by Monday-to-Sunday week.
// Run with: node --experimental-strip-types --test lib/accounting/depositWeeks.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { depositWeeks, isDate, isMonth, monthSpan, weeksOf } from "./depositWeeksCore.ts";

test("the month runs to today when today is inside it, else to its last day", () => {
  assert.deepEqual(monthSpan("2026-11", "2026-11-26"), { from: "2026-11-01", to: "2026-11-30", through: "2026-11-26" });
  assert.deepEqual(monthSpan("2026-10", "2026-11-26"), { from: "2026-10-01", to: "2026-10-31", through: "2026-10-31" });
  assert.deepEqual(monthSpan("2028-02", null), { from: "2028-02-01", to: "2028-02-29", through: "2028-02-29" });
});

test("weeks run Monday to Sunday, cut at the month's start and at today", () => {
  // 1 Nov 2026 is a Sunday.
  assert.deepEqual(weeksOf("2026-11-01", "2026-11-26"), [
    { from: "2026-11-01", to: "2026-11-01" },
    { from: "2026-11-02", to: "2026-11-08" },
    { from: "2026-11-09", to: "2026-11-15" },
    { from: "2026-11-16", to: "2026-11-22" },
    { from: "2026-11-23", to: "2026-11-26" },
  ]);
});

test("each deposit lands in its week; the bars add up to the month's total; withdrawals and other months are left out", () => {
  const out = depositWeeks("2026-11", "2026-11-26", [
    { posted_on: "2026-11-01", amount_cents: 100 },
    { posted_on: "2026-11-03", amount_cents: 2_200_000 },
    { posted_on: "2026-11-08", amount_cents: 50 },
    { posted_on: "2026-11-24", amount_cents: 2_700_000 },
    { posted_on: "2026-11-24", amount_cents: -900 },
    { posted_on: "2026-10-31", amount_cents: 999 },
    { posted_on: "2026-11-27", amount_cents: 999 },
  ]);
  assert.deepEqual(out.weeks.map((w) => w.cents), [100, 2_200_050, 0, 0, 2_700_000]);
  assert.equal(out.totalCents, 4_900_150);
  assert.equal(out.count, 4);
});

test("only a real month and day are read", () => {
  assert.equal(isMonth("2026-11"), true);
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isDate("2026-11-26"), true);
  assert.equal(isDate("2026-11-xx"), false);
});
