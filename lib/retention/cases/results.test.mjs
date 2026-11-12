// Retention › Results, what the ladder saved (round 7, owner pick 0·A/5·A/6·A, 2026-11-10).
// Run with: node --experimental-strip-types --test lib/retention/cases/results.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { MIN_RESULTS_DECIDED, caseResults, daysToSave, hasFigures, median, resultRateText, resultsPeriodOf, resultsSince, saveDayBuckets } from "./results.ts";
import { caseTrend } from "./trend.ts";

const c = (step, status, extra = {}) => ({ step, status, carrierId: "am", carrierName: "Americo", openedAt: "2026-10-01T00:00:00Z", resolvedAt: null, monthlyCents: 6000, ...extra });

test("opened and closed count inside the period; open counts whenever it opened", () => {
  const r = caseResults([
    c("payment_problem", "saved", { resolvedAt: "2026-10-11T00:00:00Z" }),
    c("payment_problem", "lost", { resolvedAt: "2026-10-05T00:00:00Z" }),
    c("payment_problem", "closed_no_save", { resolvedAt: "2026-10-03T00:00:00Z" }),
    c("pending_lapse", "working", { openedAt: "2026-01-01T00:00:00Z" }),
    // Closed before the period: neither opened nor closed in it.
    c("pending_lapse", "saved", { openedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-02-01T00:00:00Z" }),
    c("paperwork", "open", { carrierId: "aa", carrierName: "American Amicable" }),
  ], "2026-09-01");
  const pay = r.byStep.find((l) => l.key === "payment_problem");
  assert.deepEqual([pay.opened, pay.saved, pay.lost, pay.closedNoSave, pay.keptCents], [3, 1, 1, 1, 6000]);
  const lapse = r.byStep.find((l) => l.key === "pending_lapse");
  assert.deepEqual([lapse.opened, lapse.open, lapse.saved, lapse.openCents], [0, 1, 0, 6000]);
  assert.deepEqual([r.total.opened, r.total.open, r.total.saved, r.total.lost], [4, 2, 1, 1]);
  assert.deepEqual(r.byStep.map((l) => l.key), ["payment_problem", "pending_lapse", "lapsed_reinstatable", "lost", "paperwork"]);
  assert.deepEqual(r.byCarrier.map((l) => [l.label, l.opened]), [["Americo", 3], ["American Amicable", 1]]);
  assert.equal(hasFigures(r.byStep.find((l) => l.key === "lost")), false);
});

test("under 20 decided cases the counts, never a percentage", () => {
  const many = (n, status) => Array.from({ length: n }, () => c("pending_lapse", status, { resolvedAt: "2026-10-20T00:00:00Z" }));
  const few = caseResults([...many(3, "saved"), ...many(2, "lost")], null).total;
  assert.equal(few.rate, null);
  assert.equal(resultRateText(few), "3 of 5 saved");
  const enough = caseResults([...many(15, "saved"), ...many(5, "lost")], null).total;
  assert.equal(MIN_RESULTS_DECIDED, 20);
  assert.equal(resultRateText(enough), "75%");
  assert.equal(resultRateText(caseResults([c("paperwork", "open")], null).total), "—");
});

test("time to save: days opened to proven, the median by step", () => {
  assert.equal(daysToSave("2026-10-01T00:00:00Z", "2026-10-11T00:00:00Z"), 10);
  assert.equal(median([]), null);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 2, 4, 9]), 3);
  const r = caseResults([
    c("payment_problem", "saved", { resolvedAt: "2026-10-05T00:00:00Z" }),
    c("payment_problem", "saved", { resolvedAt: "2026-10-21T00:00:00Z" }),
    c("pending_lapse", "saved", { resolvedAt: "2026-10-09T00:00:00Z" }),
    c("pending_lapse", "lost", { resolvedAt: "2026-10-09T00:00:00Z" }),
  ], null);
  const pay = r.times.find((t) => t.key === "payment_problem");
  assert.deepEqual([pay.saves, pay.medianDays, pay.fastestDays, pay.slowestDays], [2, 12, 4, 20]);
  assert.deepEqual([r.totalTime.saves, r.totalTime.medianDays], [3, 8]);
  assert.equal(r.times.find((t) => t.key === "paperwork").medianDays, null);
});

test("the period from the address, and its first day", () => {
  assert.equal(resultsPeriodOf("year"), "year");
  assert.equal(resultsPeriodOf("nonsense"), "quarter");
  assert.equal(resultsSince("quarter", "2026-11-10"), "2026-08-12");
  assert.equal(resultsSince("all", "2026-11-10"), null);
});

test("Time to save's chart: saves by how long they took, from opened and proven (round 7, 10·3)", () => {
  assert.deepEqual(saveDayBuckets([0, 0, 3, 7, 8, 14, 15, 30, 31, 400]).map((b) => [b.key, b.saves]), [["same", 2], ["week", 2], ["fortnight", 2], ["month", 2], ["later", 2]]);
  const r = caseResults([
    c("payment_problem", "saved", { openedAt: "2026-10-01T09:00:00Z", resolvedAt: "2026-10-01T15:00:00Z" }),
    c("paperwork", "saved", { openedAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-10-20T00:00:00Z" }),
    c("paperwork", "lost", { resolvedAt: "2026-10-20T00:00:00Z" }),
  ], "2026-09-01");
  assert.deepEqual(r.saveDays.map((b) => b.saves), [1, 0, 0, 1, 0]);
  assert.equal(r.saveDays.reduce((n, b) => n + b.saves, 0), r.totalTime.saves);
});

test("the cards' sparklines: open at each week's end, saves and losses in the week, the rate so far (0·C)", () => {
  const t = caseTrend([
    { status: "open", openedAt: "2026-10-01T00:00:00Z", resolvedAt: null },
    { status: "saved", openedAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-10-20T00:00:00Z" },
    { status: "lost", openedAt: "2026-10-01T00:00:00Z", resolvedAt: "2026-11-05T00:00:00Z" },
  ], "2026-09-12", "2026-11-10");
  assert.equal(t.ends.length, 9, "about two months in weeks");
  assert.equal(t.ends.at(-1), "2026-11-10", "the last point is today");
  assert.equal(t.open.at(-1), 1, "only the open case is open today");
  assert.equal(t.open[0], 0, "nothing had opened in the first week");
  assert.equal(Math.max(...t.open), 3);
  assert.equal(t.saved.reduce((a, b) => a + b, 0), 1);
  assert.equal(t.lost.reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(t.rate, [100, 100, 100, 50], "a point from the first decided case, the rate so far");
  assert.equal(caseTrend([], "2025-11-10", "2026-11-10").ends.length, 13, "a year in 30-day buckets");
});
