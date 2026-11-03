import test from "node:test";
import assert from "node:assert/strict";

import { bestBucket, compareTail, shiftDay, spanDays, trendSeries, WEEK_STEP_AFTER_DAYS } from "./trend.ts";

/**
 * The submission series the Overview and Team review both draw. The numbers on those two pages are
 * the same numbers, so the awkward cases live here rather than being eyeballed on either chart.
 *
 * Moments are written as local wall-clock strings ("2026-10-30T09:00") on purpose: the helper buckets
 * by the viewer's own calendar day, and a Z-suffixed time would make these tests depend on the zone
 * the suite happens to run in.
 */

const NOW = new Date("2026-10-30T12:00:00").getTime();
const at = (day, hour = 9) => `${day}T${String(hour).padStart(2, "0")}:00:00`;

/* ── Days ────────────────────────────────────────────────────────────────────────────────────── */

test("a single day is one bucket holding that day's submissions", () => {
  const trend = trendSeries([at("2026-10-30"), at("2026-10-30", 17)], { from: "2026-10-30", to: "2026-10-30", now: NOW });
  assert.equal(trend.step, 1);
  assert.equal(trend.buckets.length, 1);
  assert.deepEqual([trend.buckets[0].label, trend.buckets[0].count], ["30 Oct", 2]);
  assert.deepEqual([trend.max, trend.total], [2, 2]);
});

test("every day in the range gets a bucket, quiet ones included", () => {
  const trend = trendSeries([at("2026-10-30")], { from: "2026-10-28", to: "2026-10-30", now: NOW });
  assert.deepEqual(trend.buckets.map((bucket) => bucket.count), [0, 0, 1]);
  assert.deepEqual(trend.buckets.map((bucket) => bucket.label), ["28 Oct", "29 Oct", "30 Oct"]);
});

test("a range crossing a month keeps counting", () => {
  const trend = trendSeries(
    [at("2026-10-30"), at("2026-10-31"), at("2026-11-01"), at("2026-11-02"), at("2026-11-02", 20)],
    { from: "2026-10-30", to: "2026-11-02", now: NOW },
  );
  assert.deepEqual(trend.buckets.map((bucket) => `${bucket.label}=${bucket.count}`), ["30 Oct=1", "31 Oct=1", "1 Nov=1", "2 Nov=2"]);
  assert.equal(trend.total, 5);
});

test("a day in another year says which year", () => {
  const trend = trendSeries([], { from: "2025-12-31", to: "2025-12-31", now: NOW });
  assert.equal(trend.buckets[0].label, "31 Dec 2025");
});

/* ── Weeks ───────────────────────────────────────────────────────────────────────────────────── */

test("past the step boundary a bar becomes a week, and not a day before", () => {
  const dayRange = { from: "2026-01-01", to: shiftDay("2026-01-01", WEEK_STEP_AFTER_DAYS - 1), now: NOW };
  assert.equal(spanDays(dayRange.from, dayRange.to), WEEK_STEP_AFTER_DAYS);
  assert.equal(trendSeries([], dayRange).step, 1, "exactly the boundary is still days");

  const weekRange = { from: "2026-01-01", to: shiftDay("2026-01-01", WEEK_STEP_AFTER_DAYS), now: NOW };
  const weekly = trendSeries([], weekRange);
  assert.equal(weekly.step, 7);
  assert.equal(weekly.buckets.length, Math.ceil((WEEK_STEP_AFTER_DAYS + 1) / 7));
});

test("a week bucket is labelled from its first day to its last, and the final one is short", () => {
  // 66 days: nine full weeks and three days left over.
  const trend = trendSeries([at("2026-03-07")], { from: "2026-01-01", to: shiftDay("2026-01-01", 65), now: NOW });
  assert.equal(trend.buckets[0].label, "1 Jan – 7 Jan");
  const last = trend.buckets.at(-1);
  assert.deepEqual([last.from, last.to], ["2026-03-05", "2026-03-07"], "the tail week stops at the range's end");
  assert.equal(last.count, 1);
});

/* ── What is left out ────────────────────────────────────────────────────────────────────────── */

test("a range longer than the data draws empty bars rather than nothing", () => {
  const trend = trendSeries([at("2026-10-30")], { from: "2026-10-01", to: "2026-10-30", now: NOW });
  assert.equal(trend.buckets.length, 30);
  assert.equal(trend.total, 1);
  assert.equal(trend.buckets.filter((bucket) => bucket.count === 0).length, 29);
});

test("a submission outside the range is left out, not folded into the nearest bar", () => {
  const trend = trendSeries(
    [at("2026-10-27"), at("2026-10-29"), at("2026-10-31")],
    { from: "2026-10-28", to: "2026-10-30", now: NOW },
  );
  assert.deepEqual(trend.buckets.map((bucket) => bucket.count), [0, 1, 0]);
  assert.equal(trend.total, 1, "the two outside it are counted nowhere");
});

test("an unreadable date is skipped rather than taking the chart down", () => {
  const trend = trendSeries(["", "not a date", at("2026-10-30")], { from: "2026-10-30", to: "2026-10-30", now: NOW });
  assert.equal(trend.total, 1);
});

test("an empty range is empty, and an inverted one is too", () => {
  for (const range of [{ from: "", to: "" }, { from: "2026-10-30", to: "2026-10-28" }]) {
    const trend = trendSeries([at("2026-10-29")], { ...range, now: NOW });
    assert.deepEqual([trend.buckets.length, trend.max, trend.total], [0, 0, 0], JSON.stringify(range));
  }
});

test("no submissions at all means a max of zero, not one", () => {
  // The chart decides its own floor; a helper that quietly returned 1 would make "nothing" and
  // "one lead" draw the same bar.
  const trend = trendSeries([], { from: "2026-10-28", to: "2026-10-30", now: NOW });
  assert.equal(trend.max, 0);
});

/* ── The comparison and the best day ─────────────────────────────────────────────────────────── */

test("the tail is compared with the stretch before it, and named", () => {
  const buckets = Array.from({ length: 14 }, (unused, index) => ({ key: `d${index}`, label: "", from: "", to: "", count: index < 7 ? 10 : 11 }));
  const compared = compareTail(buckets, 7);
  assert.deepEqual([compared.recent, compared.previous], [77, 70]);
  assert.equal(Math.round(compared.change * 10) / 10, 10);
});

test("a rise from nothing is not a percentage", () => {
  const buckets = Array.from({ length: 14 }, (unused, index) => ({ key: `d${index}`, label: "", from: "", to: "", count: index < 7 ? 0 : 4 }));
  const compared = compareTail(buckets, 7);
  assert.deepEqual([compared.recent, compared.previous, compared.change], [28, 0, null]);
});

test("the busiest bucket is named, and an empty series has none", () => {
  const trend = trendSeries([at("2026-10-28"), at("2026-10-30"), at("2026-10-30", 11)], { from: "2026-10-28", to: "2026-10-30", now: NOW });
  assert.deepEqual([bestBucket(trend.buckets).label, bestBucket(trend.buckets).count], ["30 Oct", 2]);
  assert.equal(bestBucket(trendSeries([], { from: "2026-10-28", to: "2026-10-30", now: NOW }).buckets), null);
});
