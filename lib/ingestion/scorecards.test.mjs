// LA-4.18 (Notion sprint) · persistency, placement, chargebacks, net by week, scorecards, drill-through, daily summary.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BUCKETS, chargebacks, chargebackText, costPerSale, drillParam, drillRows, historyStart, netByWeek, persistency, persistencyAll,
  persistencyText, placement, readDrill, scorecards, shareText, slices, trueCostPerSale, wholeDollars,
} from "./scorecards.ts";
import { QUIET_DAY, buildSummary, checkProse } from "./dailySummary.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261008270000_la_4_18_scorecards.sql", import.meta.url), "utf8");

let n = 0;
const policy = (over = {}) => {
  n++;
  return {
    key: `c|P${n}`, carrierId: "c", carrierName: "Carrier C", policyNumber: `P${n}`, clientName: null, status: "active",
    issueDate: "2025-02-01", lapsedOn: null, terminationDate: null, monthsPaid: 3, annualCents: 60000,
    productKey: "fe", productName: "Final expense", agentKey: "a1", agentName: "Agent One", agencyKey: "ag", agencyName: "Agency",
    sourceKey: "none", sourceName: "Unattributed", firstSeen: "2025-01-01", applicationId: null,
    advancedCents: null, chargedBackCents: null, netCents: null, ...over,
  };
};

test("persistency at 3, 6, 9 and 13 months matches a hand-computed cohort, by count and by premium", () => {
  const today = "2026-03-15";
  const book = [
    policy({ issueDate: "2025-01-10", annualCents: 100000 }),                                      // alive at every mark
    policy({ issueDate: "2025-01-10", status: "lapsed", lapsedOn: "2025-03-01", annualCents: 50000 }), // gone before month 3 (04-10)
    policy({ issueDate: "2025-01-10", status: "lapsed", lapsedOn: "2025-08-01", annualCents: 30000 }), // alive at 3 and 6 (07-10), gone by 9
    policy({ issueDate: "2025-02-01", status: "lapsed", lapsedOn: "2025-11-01", annualCents: 20000 }), // month 9 is 11-01: lapsed that day → not alive
    policy({ issueDate: "2025-06-15", annualCents: 40000 }),                                       // 13-month mark 2026-07-15: too young for 13
    policy({ issueDate: "2025-12-20", annualCents: 10000 }),                                       // 3-month mark 2026-03-20: too young for anything
    policy({ issueDate: "2024-11-01", annualCents: 99999 }),                                       // before the history: never judged
    policy({ issueDate: "2025-03-01", status: "not_taken", annualCents: 77777 }),                  // never in force: placement's, not persistency's
  ];
  const start = historyStart(book);
  assert.equal(start, "2025-01-01");
  const [m3, m6, m9, m13] = persistencyAll(book, today, start);
  assert.deepEqual([m3.eligible, m3.alive, m3.premiumEligibleCents, m3.premiumAliveCents], [5, 4, 240000, 190000]);
  assert.deepEqual([m6.eligible, m6.alive, m6.premiumAliveCents], [5, 4, 190000]);
  assert.deepEqual([m9.eligible, m9.alive, m9.premiumEligibleCents, m9.premiumAliveCents], [5, 2, 240000, 140000]);
  assert.deepEqual([m13.eligible, m13.alive, m13.premiumAliveCents], [4, 1, 100000]);
  assert.equal(persistencyText(m9, "count", 5), "40%");
  assert.equal(persistencyText(m9, "premium", 5), "58%", "they diverge: the large policy survived");
  assert.equal(m9.members.filter((m) => m.alive).length, m9.alive);
});

test("a bucket under the sample size shows a count; one without the history shows building", () => {
  const book = [policy({ issueDate: "2026-01-05", firstSeen: "2026-01-02" }), policy({ issueDate: "2026-01-06", firstSeen: "2026-01-02", status: "lapsed", lapsedOn: "2026-02-01" })];
  const start = historyStart(book);
  const [m3, , , m13] = persistencyAll(book, "2026-04-10", start);
  assert.equal(persistencyText(m3, "count", 10), "1 of 2");
  assert.equal(persistencyText(m3, "premium", 10), "1 of 2", "the premium share obeys the same sample rule");
  assert.equal(m13.building, true);
  assert.equal(m13.readyOn, "2027-02-02");
  assert.equal(persistencyText(m13, "count", 10), "Building");
  assert.equal(m13.eligible, 0, "no figure from the policies that happen to be old enough");
  assert.equal(shareText(3, 5, 10), "3 of 5");
  assert.equal(shareText(30, 37, 10), "81%");
});

test("placement: issued is not placed; placed is paid at least once", () => {
  const book = [
    policy({ key: "c|a", issueDate: "2026-01-10", monthsPaid: 2, applicationId: "app1" }),
    policy({ key: "c|b", issueDate: "2026-01-12", status: "approved_unpaid", monthsPaid: 0, applicationId: "app2" }),
    policy({ key: "c|c", issueDate: "2026-02-01", status: "lapsed", monthsPaid: 1 }),
    policy({ key: "c|d", issueDate: "2026-02-03", status: "declined", monthsPaid: null }),
    policy({ key: "c|e", issueDate: "2025-06-01", monthsPaid: 8 }),
  ];
  const subs = [{ applicationId: "app1", carrierId: "c", submittedOn: "2026-01-02" }, { applicationId: "app2", carrierId: "c", submittedOn: "2026-01-03" }, { applicationId: "app3", carrierId: "c", submittedOn: "2026-01-04" }];
  const p = placement(book, subs, "2026-01-01", "2026-03-31");
  assert.deepEqual(p.issued, ["c|a", "c|b", "c|c"]);
  assert.deepEqual(p.placed, ["c|a", "c|c"]);
  assert.deepEqual(p.notPlaced, ["c|b"]);
  assert.deepEqual([p.submitted, p.submittedIssued], [3, 2]);
  assert.deepEqual(placement(book, [], "2026-01-01", "2026-03-31").submitted, null);
});

test("true cost per sale matches the worked Apex / Vertex example", () => {
  const apex = { building: false, eligible: 37, alive: 30 };
  const vertex = { building: false, eligible: 39, alive: 23 };
  assert.equal(shareText(30, 37, 10), "81%");
  assert.equal(shareText(23, 39, 10), "59%");
  assert.equal(wholeDollars(costPerSale(620500, 11)), "$564");
  assert.equal(wholeDollars(costPerSale(289000, 6)), "$482");
  assert.equal(wholeDollars(trueCostPerSale(620500, 11, apex, 10)), "$696");
  assert.equal(wholeDollars(trueCostPerSale(289000, 6, vertex, 10)), "$817", "cheaper per sale, dearer once lapses count");
  assert.equal(trueCostPerSale(289000, 6, { building: false, eligible: 5, alive: 3 }, 10), null, "under the sample size: no figure");
  assert.equal(trueCostPerSale(289000, 6, { building: true, eligible: 0, alive: 0 }, 10), null);
});

test("chargeback ratio, net commission by week", () => {
  const book = [
    ...Array.from({ length: 10 }, () => policy({ carrierId: "x", carrierName: "X", advancedCents: 50000, chargedBackCents: 0 })),
    policy({ carrierId: "x", carrierName: "X", advancedCents: 50000, chargedBackCents: -50000 }),
    policy({ carrierId: "y", carrierName: "Y", advancedCents: 40000, chargedBackCents: -10000 }),
    policy({ carrierId: "z", carrierName: "Z" }),
  ];
  const rows = chargebacks(book, "carrier");
  const x = rows.find((r) => r.key === "x");
  assert.deepEqual([x.advancedCents, x.chargedBackCents, x.advancedPolicies], [550000, 50000, 11]);
  assert.equal(chargebackText(x, 10), "9%");
  assert.equal(chargebackText(rows.find((r) => r.key === "y"), 10), null, "one policy is not a ratio");
  assert.equal(rows.some((r) => r.key === "z"), false, "no advance on file: not in the ratio");

  const weeks = netByWeek([
    { week: "2026-09-28", type: "advance", cents: 120000, entries: 2 },
    { week: "2026-09-28", type: "chargeback", cents: -30000, entries: 1 },
    { week: "2026-09-28", type: "fee", cents: -500, entries: 1 },
    { week: "2026-09-28", type: "advance_interest", cents: -1200, entries: 1 },
    { week: "2026-09-28", type: "held", cents: 9000, entries: 1 },
    { week: "2026-10-05", type: "earned", cents: 4100, entries: 1 },
  ]);
  assert.deepEqual(weeks.map((w) => [w.week, w.netCents, w.heldCents, w.entries]), [["2026-10-05", 4100, 0, 1], ["2026-09-28", 88300, 9000, 6]]);
});

test("every figure drills to exactly the rows that made it", () => {
  const today = "2026-10-08";
  const book = [
    ...Array.from({ length: 12 }, (_, i) => policy({ issueDate: `2025-0${(i % 6) + 1}-15`, firstSeen: "2025-01-02", sourceKey: "apex", sourceName: "Apex", status: i % 4 === 0 ? "lapsed" : "active", lapsedOn: i % 4 === 0 ? "2025-09-01" : null, advancedCents: 40000, chargedBackCents: i % 4 === 0 ? -40000 : 0 })),
    ...Array.from({ length: 4 }, () => policy({ issueDate: "2026-08-01", firstSeen: "2025-01-02", carrierId: "d", carrierName: "D", productKey: "term", productName: "Term", monthsPaid: 0, status: "approved_unpaid" })),
  ];
  const ctx = { today, start: historyStart(book), from: "2026-01-01", to: "2026-12-31", minSample: 10 };
  for (const s of [...slices(book, "carrier"), ...slices(book, "status")]) {
    const dim = book.some((p) => p.carrierId === s.key) ? "carrier" : "status";
    assert.equal(drillRows(book, { kind: "book", dim, key: s.key }, ctx).rows.length, s.policies);
  }
  for (const month of BUCKETS) {
    const cell = persistency(book, month, today, ctx.start);
    const drill = drillRows(book, { kind: "persistency", month, dim: "all", key: "" }, ctx);
    assert.equal(drill.rows.length, cell.eligible);
    assert.equal(drill.rows.filter((r) => r.tone === "good").length, cell.alive);
  }
  const pl = placement(book, [], ctx.from, ctx.to);
  assert.equal(drillRows(book, { kind: "placement", set: "not_placed" }, ctx).rows.length, pl.notPlaced.length);
  for (const r of chargebacks(book, "source")) assert.equal(drillRows(book, { kind: "chargeback", dim: "source", key: r.key }, ctx).rows.length, r.members.length);
  const apex = scorecards(book, "source", { ...ctx, spend: new Map([["apex", 100000]]) }).find((c) => c.key === "apex");
  assert.equal(drillRows(book, { kind: "sales", key: "apex" }, ctx).rows.length, apex.sales);
  assert.equal(apex.spendCents, 100000);
});

test("drill links round-trip any key, and refuse anything else", () => {
  const d = { kind: "book", dim: "product", key: "FE ~ 50/50: gold & co" };
  assert.deepEqual(readDrill(drillParam(d)), d);
  assert.deepEqual(readDrill(drillParam({ kind: "persistency", month: 9, dim: "source", key: "apex" })), { kind: "persistency", month: 9, dim: "source", key: "apex" });
  assert.deepEqual(readDrill(drillParam({ kind: "week", week: "2026-09-28" })), { kind: "week", week: "2026-09-28" });
  for (const bad of ["persistency~7~all~", "book~nope~x", "week~yesterday", "drop table", "", null]) assert.equal(readDrill(bad), null, String(bad));
});

test("the daily summary: only figures from its input, no prediction, and quiet days say so", () => {
  const source = { date: "2026-10-08", lapsed: 2, issued: 1, atRisk: 3, chargebacks: { lines: 2, cents: -123456 }, closingSoon: 4, closingDays: 3, contract: { building: false, eligible: 20, alive: 11 }, minSample: 10 };
  const input = buildSummary(source);
  assert.deepEqual(input.facts.map((f) => f.id), ["closing", "lapsed", "at_risk", "chargebacks", "contract", "issued"]);
  for (const fact of input.facts) {
    assert.ok(fact.href.startsWith("/app/"), "every claim links through");
    assert.equal(checkProse(fact.text, input).ok, true, fact.text);
  }
  assert.match(input.facts.find((f) => f.id === "chargebacks").text, /\$1,234\.56/);
  assert.match(input.facts.find((f) => f.id === "contract").text, /55%/);
  const stray = checkProse("4 policies are closing and 7 more lapsed, $1,234.56 charged back.", input);
  assert.deepEqual(stray.strayFigures, ["7"]);
  assert.equal(checkProse("Two policies will likely lapse next week.", input).prediction, "will");
  assert.equal(checkProse("Persistency is expected to recover.", input).ok, false);
  assert.deepEqual(buildSummary({ ...source, lapsed: 0, issued: 0, atRisk: 0, chargebacks: { lines: 0, cents: 0 }, closingSoon: 0, contract: null }).facts, []);
  assert.equal(QUIET_DAY, "Nothing notable today.");
  assert.equal(buildSummary({ ...source, contract: { building: false, eligible: 5, alive: 1 } }).facts.some((f) => f.id === "contract"), false, "no share on a small sample");
});

test("the migration: computed live, one setting stored, the ledger summed in the database", () => {
  assert.match(sql, /min_sample integer not null default 10/);
  assert.match(sql, /constraint book_insight_settings_sample check \(min_sample between 2 and 100\)/);
  assert.match(sql, /revoke delete, truncate on public\.book_insight_settings from service_role, tenant_app/);
  assert.match(sql, /not exists \(select 1 from public\.carrier_account_checks c where c\.tenant_id = e\.tenant_id and c\.file_id = e\.file_id and c\.flagged\)/);
  assert.doesNotMatch(sql, /cron\.schedule/, "no nightly batch");
});
