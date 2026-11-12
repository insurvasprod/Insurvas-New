// Run with: npm test
//
// Queue scoring's chart view (Reports round 7, owner picks 3·B + 3·C + 3·3, 2026-11-11): the comparison by day
// is read in one query and bucketed in TypeScript; each arm's line is its rate to date, so its last point is the
// card's figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bySignalOrder, cohortDays, dayInZone, daysBetween, scoreFigure, signalTone, SIGNAL_ORDER, sumDays } from "./series.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("a serve falls on the agency's day, not UTC's", () => {
  assert.equal(dayInZone("2026-11-05T03:30:00Z", "America/Chicago"), "2026-11-04");
  assert.equal(dayInZone("2026-11-05T03:30:00Z", "UTC"), "2026-11-05");
  assert.equal(dayInZone("not a date", "UTC"), "");
  assert.deepEqual(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(daysBetween("2026-11-02", "2026-11-01"), []);
  assert.equal(daysBetween("2026-01-01", "2026-12-31", 14).length, 14);
});

test("each arm's line is its rate to date, and a quiet day keeps the rate it had", () => {
  const rows = [
    { servedAt: "2026-11-01T15:00:00Z", cohort: "scored", contacted: true },
    { servedAt: "2026-11-01T16:00:00Z", cohort: "scored", contacted: false },
    { servedAt: "2026-11-01T17:00:00Z", cohort: "control", contacted: false },
    { servedAt: "2026-11-03T15:00:00Z", cohort: "scored", contacted: false },
    { servedAt: "2026-11-03T15:30:00Z", cohort: "scored", contacted: true },
  ];
  const days = cohortDays(rows, daysBetween("2026-11-01", "2026-11-03"), "UTC");
  assert.deepEqual(days.map((day) => day.scoredRatePct), [50, 50, 50]);
  assert.deepEqual(days.map((day) => day.controlRatePct), [0, 0, 0]);
  assert.equal(days[1].scoredServed, 0, "a quiet day has no dials of its own");
  assert.equal(days[2].scoredServed, 2);
  // The last point is the arm's figure over the window.
  const sum = sumDays(rows);
  assert.equal(days.at(-1).scoredRatePct, Math.round((1000 * sum.scoredContacted) / sum.scoredServed) / 10);
});

test("all time carries the history before the drawn days, so the line ends on the all-time rate", () => {
  const rows = [{ servedAt: "2026-11-01T15:00:00Z", cohort: "scored", contacted: true }];
  const days = cohortDays(rows, ["2026-11-01"], "UTC", { scoredServed: 9, scoredContacted: 0, controlServed: 0, controlContacted: 0 });
  assert.equal(days[0].scoredRatePct, 10);
  assert.equal(days[0].controlRatePct, null, "an arm with no dials has no rate, not 0%");
});

test("every picture gives a signal the same colour, in the board's order", () => {
  assert.equal(new Set(SIGNAL_ORDER.map(signalTone)).size, SIGNAL_ORDER.length);
  assert.deepEqual(bySignalOrder([{ signal: "consent_artefact" }, { signal: "recency" }, { signal: "x" }]).map((s) => s.signal), ["recency", "consent_artefact", "x"]);
  assert.equal(scoreFigure(58.75), "58.75");
  assert.equal(scoreFigure(null), "—");
});

test("the daily series is one read of the decisions, never an RPC a row", () => {
  const service = read("lib", "scoring", "service.ts");
  const fn = service.match(/async function readDaily[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.ok(fn, "readDaily exists");
  assert.match(fn, /from\("tenant_scoring_decisions"\)\.select\("served_at, cohort, contacted_at"\)\.eq\("tenant_id", tenantId\)/);
  assert.doesNotMatch(fn, /\.rpc\(/);
  // It runs beside the other reads, not after them.
  assert.match(service, /readDaily\(db, tenantId, period\),\n  \]\);/);
});

test("the page has the switch, the chart first, and the dialogs the board draws", () => {
  assert.match(read("app", "app", "(shell)", "scoring", "page.tsx"), /<ReportsPage view="scoring" show="chart"/);
  const workspace = read("components", "app", "scoring-workspace.tsx");
  assert.match(workspace, /useShow\("chart"\)/);
  assert.match(workspace, /<LineSeries/);
  assert.match(workspace, /<ShareBar/);
  assert.doesNotMatch(workspace, /DonutChart|SIGNAL_COLOURS/);
  assert.match(workspace, /<ChangeWeightsDialog /);
  assert.match(read("components", "app", "scoring", "next-up.tsx"), /segments: parts\.length \?/);
});
