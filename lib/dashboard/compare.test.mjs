// Run with: node --experimental-strip-types --test lib/dashboard/compare.test.mjs
//
// Home › Agency › Compare (owner 2026-11-07): the period pairs and the figures behind both directions.
import { test } from "node:test";
import assert from "node:assert/strict";

import { change, changeBy, changeRead, dailyFor, initials, contactRate, dialsByDay, figuresBy, followingB, periodPair, placement, rangeLabel, running } from "./compare.ts";

const TODAY = "2026-11-06"; // a Friday

test("each preset is the period so far against the same stretch before it", () => {
  assert.deepEqual(periodPair("month", TODAY), { preset: "month", a: { from: "2026-11-01", to: "2026-11-06" }, b: { from: "2026-10-01", to: "2026-10-06" }, aLabel: "Nov 1–6, 2026", bLabel: "Oct 1–6, 2026" });
  const week = periodPair("week", TODAY);
  assert.deepEqual([week.a, week.b], [{ from: "2026-11-02", to: "2026-11-06" }, { from: "2026-10-26", to: "2026-10-30" }]);
  const day = periodPair("day", TODAY);
  assert.deepEqual([day.a, day.b], [{ from: TODAY, to: TODAY }, { from: "2026-11-05", to: "2026-11-05" }]);
  const ytd = periodPair("ytd", TODAY);
  assert.deepEqual([ytd.a, ytd.b], [{ from: "2026-01-01", to: TODAY }, { from: "2025-01-01", to: "2025-11-06" }]);
  const q = periodPair("quarter", TODAY);
  assert.deepEqual([q.a, q.b], [{ from: "2026-10-01", to: TODAY }, { from: "2026-07-01", to: "2026-08-06" }]);
});

test("a month-end day never runs past the shorter month before it", () => {
  assert.deepEqual(periodPair("month", "2026-03-31").b, { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodPair("month", "2026-01-15").b, { from: "2025-12-01", to: "2025-12-15" });
});

test("a custom pair is taken as given, and a broken one falls back to this month", () => {
  const ok = periodPair("custom", TODAY, { a: { from: "2026-10-01", to: "2026-10-31" }, b: { from: "2025-10-01", to: "2025-10-31" } });
  assert.equal(ok.aLabel, "Oct 1–31, 2026");
  assert.equal(periodPair("custom", TODAY, { a: { from: "2026-10-31", to: "2026-10-01" } }).preset, "month");
});

test("the custom pop-up's rules for the second period", () => {
  const a = { from: "2026-11-01", to: "2026-11-06" };
  assert.deepEqual(followingB(a, "month"), { from: "2026-10-01", to: "2026-10-06" });
  assert.deepEqual(followingB(a, "year"), { from: "2025-11-01", to: "2025-11-06" });
  assert.deepEqual(followingB(a, "before"), { from: "2026-10-26", to: "2026-10-31" });
});

test("range labels read like the mockup", () => {
  assert.equal(rangeLabel({ from: "2026-10-26", to: "2026-11-01" }), "Oct 26 – Nov 1, 2026");
  assert.equal(rangeLabel({ from: TODAY, to: TODAY }), "Nov 6, 2026");
});

const events = {
  calls: [{ who: "a", day: "2026-11-02", contact: true }, { who: "a", day: "2026-11-02", contact: false }, { who: "b", day: "2026-11-03", contact: true }, { who: "a", day: "2026-10-02", contact: false }],
  quotes: [{ who: "a", day: "2026-11-02" }],
  apps: [{ who: "a", day: "2026-11-03", issued: true }, { who: "b", day: "2026-11-04", issued: false }],
  policies: [{ who: "a", day: "2026-11-03", cents: 120000 }, { who: null, day: "2026-11-04", cents: 5000 }, { who: "b", day: "2026-10-03", cents: 80000 }],
};
const NOV = { from: "2026-11-01", to: "2026-11-06" };
const OCT = { from: "2026-10-01", to: "2026-10-06" };

test("figures count each person and the whole, a policy with no agent in the whole only", () => {
  const { total, by } = figuresBy(events, NOV);
  assert.deepEqual(total, { dials: 3, contacts: 2, quotes: 1, apps: 2, appsIssued: 1, issued: 2, premiumCents: 125000 });
  assert.equal(by.get("a").dials, 2);
  assert.equal(by.get("").premiumCents, 5000);
  assert.equal(placement(total), 50);
  assert.equal(contactRate(total), 67);
});

test("running totals per day, for everyone or one person; dials by day", () => {
  assert.deepEqual(running(events, NOV, "premium"), [0, 0, 120000, 125000, 125000, 125000]);
  assert.deepEqual(running(events, NOV, "dials", "a"), [0, 2, 2, 2, 2, 2]);
  assert.deepEqual(dialsByDay(events, NOV, "b"), [0, 0, 1, 0, 0, 0]);
});

test("where the change came from: biggest gain first, unchanged people left out", () => {
  const now = figuresBy(events, NOV).by;
  const then = figuresBy(events, OCT).by;
  assert.deepEqual(changeBy(now, then), [{ who: "a", cents: 120000 }, { who: "b", cents: -80000 }]);
  assert.equal(change(110, 100), 10);
  assert.equal(change(5, 0), null);
  assert.equal(Object.is(change(100, 100), -0), false);
});

test("a change off a tiny base reads as new or ×, not thousands of percent", () => {
  assert.deepEqual(changeRead(60, 1), { kind: "times", text: "60×" });
  assert.deepEqual(changeRead(5, 0), { kind: "new" });
  assert.deepEqual(changeRead(110, 100), { kind: "pct", value: 10 });
  assert.equal(changeRead(0, 0), null);
  assert.equal(changeRead(100, 100), null);
  assert.equal(initials("Devin Okafor"), "DO");
  assert.equal(initials("Leah"), "L");
  assert.deepEqual(dailyFor(events, NOV, "premium", "a"), [0, 0, 120000, 0, 0, 0]);
});
