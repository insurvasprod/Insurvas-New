// Run with: npm test
//
// The partner detail page counts its figures in TypeScript from partner_quality_evidence, while the
// list page gets them from partner_quality_report in SQL. These pin the TypeScript side to the SQL
// rules, so a partner's page and its row on the list cannot disagree.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dailyVolume,
  datesBetween,
  defaultPartnerQualityPeriod,
  dispositionBreakdown,
  percentChange,
  periodMetrics,
  pointChange,
  previousPartnerQualityPeriod,
  screeningLabel,
  screeningPassRate,
  validPartnerQualityPeriod,
} from "./metrics.ts";

const lead = (overrides = {}) => ({
  lead_id: crypto.randomUUID(), partner_id: "p", lead_date: "2026-09-10", full_name: "A", phone: null,
  screening_outcome: "clear", screening_result_outcome: null, claimed: false, worked: false, submitted: false, duplicate: false, disposition: null,
  ...overrides,
});

test("the prior period is the same length, immediately before (partner_quality_report's rule)", () => {
  assert.deepEqual(previousPartnerQualityPeriod("2026-09-01", "2026-09-30"), { from: "2026-08-02", to: "2026-08-31" });
  assert.deepEqual(previousPartnerQualityPeriod("2026-03-01", "2026-03-01"), { from: "2026-02-28", to: "2026-02-28" });
});

test("the default period is the last 30 reporting days in fixed EST", () => {
  // 03:00 UTC on 1 Oct is still 30 Sep at UTC-5.
  assert.deepEqual(defaultPartnerQualityPeriod(new Date("2026-10-01T03:00:00Z")), { from: "2026-09-01", to: "2026-09-30" });
});

test("a period from the query string must be two ordered ISO dates", () => {
  assert.deepEqual(validPartnerQualityPeriod("2026-09-01", "2026-09-28"), { from: "2026-09-01", to: "2026-09-28" });
  assert.equal(validPartnerQualityPeriod("2026-09-28", "2026-09-01"), null);
  assert.equal(validPartnerQualityPeriod("yesterday", "2026-09-01"), null);
  assert.equal(validPartnerQualityPeriod(undefined, "2026-09-01"), null);
});

test("period metrics count exactly what the SQL report counts", () => {
  const metrics = periodMetrics([
    lead({ claimed: true, worked: true, submitted: true }),
    lead({ claimed: true, worked: true, screening_outcome: "internal_dq" }),
    lead({ screening_result_outcome: "tcpa_litigator" }),
    lead({ screening_outcome: "dnc" }),
    lead({ screening_result_outcome: "invalid_phone", duplicate: true }),
  ]);
  assert.deepEqual(
    { sent: metrics.sent, claimed: metrics.claimed, worked: metrics.worked, submitted: metrics.submitted, disqualified: metrics.disqualified, duplicates: metrics.duplicates },
    { sent: 5, claimed: 2, worked: 2, submitted: 1, disqualified: 1, duplicates: 1 },
  );
  assert.deepEqual(metrics.screening, { tcpa: 1, dnc: 1, invalid: 1 });
  assert.equal(metrics.conversion_rate, 20);
  assert.equal(metrics.disqualification_rate, 20);
  assert.equal(metrics.screening_pass_rate, 40);
});

test("nothing sent means no rate, not 0%", () => {
  const metrics = periodMetrics([]);
  assert.equal(metrics.conversion_rate, null);
  assert.equal(metrics.screening_pass_rate, null);
  assert.equal(screeningPassRate({ sent: 0, screening: { tcpa: 0, dnc: 0, invalid: 0 } }), null);
});

test("a lead's screening label names the worst flag first", () => {
  assert.equal(screeningLabel(lead({ screening_result_outcome: "tcpa_litigator", screening_outcome: "dnc" })), "TCPA blocked");
  assert.equal(screeningLabel(lead({ screening_outcome: "dnc" })), "DNC flagged");
  assert.equal(screeningLabel(lead({ screening_outcome: "internal_dq" })), "Disqualified");
  assert.equal(screeningLabel(lead()), "Passed");
  assert.equal(screeningLabel(lead({ screening_outcome: null })), "Not checked");
});

test("dispositions are counted per key, most common first", () => {
  const rows = [lead({ disposition: "no_answer" }), lead({ disposition: "sold" }), lead({ disposition: "no_answer" }), lead()];
  assert.deepEqual(dispositionBreakdown(rows), [{ key: "no_answer", count: 2 }, { key: "sold", count: 1 }]);
});

test("daily volume lists every day in the period, newest first, including empty days", () => {
  assert.deepEqual(datesBetween("2026-09-09", "2026-09-11"), ["2026-09-11", "2026-09-10", "2026-09-09"]);
  const days = dailyVolume([lead({ lead_date: "2026-09-10", claimed: true }), lead({ lead_date: "2026-09-10", screening_outcome: "dnc" })], "2026-09-09", "2026-09-11");
  assert.equal(days.length, 3);
  assert.deepEqual(days[1], { date: "2026-09-10", sent: 2, claimed: 1, worked: 0, submitted: 0, flagged: 1, duplicates: 0 });
  assert.equal(days[0].sent, 0);
});

test("changes: percent for counts, points for rates, nothing without a base", () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(5, 0), null);
  assert.equal(pointChange(12.5, 10.25), 2.3);
  assert.equal(pointChange(null, 10), null);
});
