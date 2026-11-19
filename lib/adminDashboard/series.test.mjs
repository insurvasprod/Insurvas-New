import test from "node:test";
import assert from "node:assert/strict";

import {
  ageWords,
  coverageNote,
  daysLate,
  eventSeries,
  flowSeries,
  funnelView,
  lastYearLine,
  levelSeries,
  netMovementCents,
  pageLink,
  periodBuckets,
  pickDashPeriod,
  signedDollars,
  tabLink,
  trialConversion,
  wholeDollars,
  yearEarlier,
} from "./series.ts";

const NOW = Date.parse("2026-11-17T15:00:00Z");

test("a period is 30 days, 13 weeks from Monday, or 12 calendar months, today in the last bucket", () => {
  const days = periodBuckets("30d", NOW);
  assert.equal(days.length, 30);
  assert.deepEqual(days.at(-1), { key: "2026-11-17", label: "17 Nov", start: "2026-11-17", end: "2026-11-18" });
  assert.equal(days[0].start, "2026-10-19");

  const weeks = periodBuckets("90d", NOW);
  assert.equal(weeks.length, 13);
  assert.equal(weeks.at(-1).start, "2026-11-16", "2026-11-17 is a Tuesday; its week starts Monday the 16th");
  assert.equal(weeks[0].start, "2026-08-24");

  const months = periodBuckets("12m", NOW);
  assert.equal(months.length, 12);
  assert.deepEqual(months.at(-1), { key: "2026-11", label: "Nov", start: "2026-11-01", end: "2026-12-01" });
  assert.deepEqual(months[0], { key: "2025-12", label: "Dec", start: "2025-12-01", end: "2026-01-01" });
});

test("the period in the address is used only when it is offered", () => {
  assert.equal(pickDashPeriod("30d", ["30d", "90d", "12m"], "12m"), "30d");
  assert.equal(pickDashPeriod("12m", ["30d", "90d"], "90d"), "90d");
  assert.equal(pickDashPeriod(null, ["30d", "90d", "12m"], "12m"), "12m");
});

const snapshots = [
  { date: "2026-09-10", mrr: 100, n: 1 },
  { date: "2026-09-11", mrr: 120, n: 2 },
  { date: "2026-09-21", mrr: 150, n: 0 },
];

test("a snapshot series leaves out buckets with no snapshot day rather than drawing them as zero", () => {
  const buckets = periodBuckets("12m", NOW);
  assert.deepEqual(levelSeries(snapshots, buckets, (day) => day.mrr), [{ key: "2026-09", label: "Sep", value: 150 }]);
  assert.deepEqual(flowSeries(snapshots, buckets, (day) => day.n), [{ key: "2026-09", label: "Sep", value: 3 }]);
  // The nightly figures stopped on 21 Sep: a 30-day graph has nothing to draw, and says so.
  assert.deepEqual(levelSeries(snapshots, periodBuckets("30d", NOW), (day) => day.mrr), []);
  assert.match(coverageNote([], periodBuckets("30d", NOW), "2026-09-21"), /stopped on 21 Sep/);
  assert.match(coverageNote([{ key: "2026-09", label: "Sep", value: 1 }], buckets, "2026-09-21"), /Ends 21 Sep/);
  assert.equal(coverageNote([], buckets, null), "No daily figures have been computed yet.");
});

test("an event series draws every bucket: an empty one is a real zero", () => {
  const buckets = periodBuckets("30d", NOW);
  const series = eventSeries([{ at: "2026-11-17T09:00:00Z" }, { at: "2026-11-17T10:00:00Z" }, { at: "2026-11-16T10:00:00Z", value: 5 }], buckets);
  assert.equal(series.length, 30);
  assert.equal(series.at(-1).value, 2);
  assert.equal(series.at(-2).value, 5);
  assert.equal(series[0].value, 0);
});

test("the last-year line is drawn only when last year has a figure for every point", () => {
  const buckets = periodBuckets("12m", NOW);
  const days = [
    { date: "2025-09-15", mrr: 10 }, { date: "2025-10-15", mrr: 20 },
    { date: "2026-09-15", mrr: 100 }, { date: "2026-10-15", mrr: 200 },
  ];
  const points = levelSeries(days, buckets, (day) => day.mrr);
  assert.deepEqual(lastYearLine(days, buckets, points, (day) => day.mrr), [
    { key: "2026-09", label: "Sep", value: 10 },
    { key: "2026-10", label: "Oct", value: 20 },
  ]);
  assert.equal(lastYearLine(days.slice(1), buckets, points, (day) => day.mrr), null, "September last year is missing");
  assert.equal(yearEarlier(buckets)[0].start, "2024-12-01");
});

test("money reads in dollars, never cents", () => {
  assert.equal(wholeDollars(348_000), "$3,480");
  assert.equal(wholeDollars(9_950), "$100");
  assert.equal(signedDollars(42_000), "+$420");
  assert.equal(signedDollars(-8_000), "−$80");
  assert.equal(netMovementCents({ date: "x", new_mrr_cents: 500, expansion_mrr_cents: 100, contraction_mrr_cents: 50, churned_mrr_cents: 200 }), 350);
});

test("ages, lateness and trial conversion", () => {
  assert.equal(ageWords(57), "57 days old");
  assert.equal(ageWords(1), "1 day old");
  assert.equal(ageWords(0), "today");
  assert.equal(ageWords(null), null);
  assert.equal(daysLate("2026-10-01T00:00:00Z", NOW), 47);
  assert.equal(daysLate("2026-12-01T00:00:00Z", NOW), 0);
  assert.equal(daysLate(null, NOW), 0);
  assert.deepEqual(trialConversion([{ status: "active" }, { status: "cancelled" }, { status: "trialing" }, { status: "past_due" }]), { converted: 2, ended: 3 });
});

test("the funnel names the largest measured drop and never an unmeasured step", () => {
  const view = funnelView([
    { label: "Signed up", count: 18, measured: true },
    { label: "Verified email", count: 16, measured: true },
    { label: "Completed profile", count: null, measured: false },
    { label: "Started a trial", count: 13, measured: true },
    { label: "Finished setup", count: 8, measured: true },
  ]);
  assert.deepEqual(view.rows.map((row) => row.share), [100, 89, null, 72, 44]);
  assert.deepEqual(view.rows.map((row) => row.drop), [false, false, false, false, true]);
  assert.equal(view.dropWords, "Biggest drop: started a trial → finished setup (38% stop here)");
  assert.equal(funnelView([{ label: "Signed up", count: 0, measured: true }]).dropWords, null);
});

test("links go only where the role can open them", () => {
  assert.equal(tabLink("super_admin", "money"), "/admin?tab=money");
  assert.equal(tabLink("support_agent", "money"), null);
  assert.equal(tabLink("super_admin", "overview", "period=30d"), "/admin?period=30d");
  assert.equal(tabLink("super_admin", "customers", "period=30d"), "/admin?tab=customers&period=30d");
  assert.equal(pageLink("support_agent", "/admin/invoices/abc"), null);
  assert.equal(pageLink("billing_admin", "/admin/invoices/abc"), "/admin/invoices/abc");
});
