import { test } from "node:test";
import assert from "node:assert/strict";

import { cohortTable, revenuePeriod, toCsv } from "./present.ts";

test("the period comes from the URL, 30 days by default", () => {
  assert.equal(revenuePeriod(undefined).days, 30);
  assert.equal(revenuePeriod("90").days, 90);
  assert.equal(revenuePeriod("12m").days, 365);
  assert.equal(revenuePeriod("7").key, "30");
  assert.equal(revenuePeriod(["12m"]).key, "12m");
});

test("a cohort counts who was still running at each offset, and leaves the future blank", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  const subs = [
    { started_at: "2026-06-10T00:00:00Z", cancelled_at: null, status: "active" },
    { started_at: "2026-06-12T00:00:00Z", cancelled_at: "2026-07-20T00:00:00Z", status: "cancelled" },
    { started_at: "2026-06-15T00:00:00Z", cancelled_at: "2026-10-01T00:00:00Z", status: "cancelled" },
    { started_at: "2026-06-20T00:00:00Z", cancelled_at: null, status: "trialing" },
    { started_at: "2026-10-05T00:00:00Z", cancelled_at: null, status: "active" },
  ];
  const rows = cohortTable(subs, now);
  assert.deepEqual(rows.map((r) => r.month), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  const june = rows[0];
  assert.equal(june.started, 3, "the trial joins no cohort");
  // 1 mo (Jul 10-15): all 3 · 2 mo (Aug): 2 · 3 mo (Sep): 2 · 6 mo (Dec): not yet.
  assert.deepEqual(june.retained, [1, 2 / 3, 2 / 3, null]);
  assert.deepEqual(rows[4].retained, [1, null, null, null]);
  assert.deepEqual(rows[1].retained, [null, null, null, null], "an empty month says nothing");
});

test("CSV fields are quoted and formulas defused", () => {
  assert.equal(toCsv([["Plan", "MRR"], ["Basic, monthly", 1234], ['Say "hi"', null], ["=SUM(A1)", -5]]), 'Plan,MRR\r\n"Basic, monthly",1234\r\n"Say ""hi""",\r\n\'=SUM(A1),-5\r\n');
});
