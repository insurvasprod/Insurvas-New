// True CPA's address and series (Reports round 7, board 7·A): lib/reports/trueCpaView.ts.
// Run with: node --experimental-strip-types --test lib/reports/trueCpaView.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cumulativeCpa, grainFromParams, reportScopeQuery, scopeFromParams, scopeQuery, seriesBuckets, stageCount } from "./trueCpaView.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const fallback = { from: "2026-08-14", to: "2026-11-11" };
const VENDOR = "2aa7431a-a4ae-4c58-8f05-625574d3363d";

test("the scope is read from the address, and a malformed value is left out", () => {
  assert.deepEqual(scopeFromParams({}, fallback), { ...fallback, vendorId: "", campaignId: "", productCode: "", persist: false });
  const scope = scopeFromParams(new URLSearchParams(`from=2026-10-01&to=2026-10-31&vendor_id=${VENDOR}&campaign_id=nope&product_code=term_life&persist_days=60`), fallback);
  assert.equal(scope.from, "2026-10-01");
  assert.equal(scope.vendorId, VENDOR);
  assert.equal(scope.campaignId, "", "a campaign id that is not a uuid never reaches the RPC");
  assert.equal(scope.persist, true);
  assert.equal(scopeQuery(scope), `from=2026-10-01&to=2026-10-31&vendor_id=${VENDOR}&product_code=term_life&persist_days=60`);
  assert.deepEqual(scopeFromParams({ from: "2026-11-11", to: "2026-08-14" }, fallback).from, fallback.from, "a reversed period falls back");
  assert.equal(grainFromParams({ by: "campaign" }), "campaign");
  assert.equal(grainFromParams({}), "vendor");
});

test("a server-rendered report is reused only for its own scope", () => {
  const report = { from: "2026-08-14", to: "2026-11-11", persist_days: null, filters: { vendor_id: VENDOR, campaign_id: null, product_code: null } };
  assert.equal(reportScopeQuery(report), scopeQuery({ ...fallback, vendorId: VENDOR, campaignId: "", productCode: "", persist: false }));
});

test("weeks cover the period exactly, at most 13 of them; months are calendar months clipped to it", () => {
  const weeks = seriesBuckets("2026-08-14", "2026-11-11");
  assert.equal(weeks.length, 13);
  assert.equal(weeks[0].from, "2026-08-14");
  assert.equal(weeks.at(-1).to, "2026-11-11");
  for (let i = 1; i < weeks.length; i += 1) assert.equal(Date.parse(weeks[i].from) - Date.parse(weeks[i - 1].to), 86_400_000, "no gap, no overlap");
  assert.ok(seriesBuckets("2025-11-12", "2026-11-11").length <= 13, "a year is 13 wider buckets, not 52 report reads");
  const months = seriesBuckets("2026-08-14", "2026-11-11", "month");
  assert.deepEqual(months.map((m) => [m.label, m.from, m.to]), [["August", "2026-08-14", "2026-08-31"], ["September", "2026-09-01", "2026-09-30"], ["October", "2026-10-01", "2026-10-31"], ["November", "2026-11-01", "2026-11-11"]]);
  assert.deepEqual(seriesBuckets("2026-11-11", "2026-11-01"), []);
});

test("True CPA to date starts at the first issued policy, never at $0", () => {
  assert.deepEqual(cumulativeCpa([{ net_spend_cents: 1000, issued_policies: 0 }, { net_spend_cents: 1000, issued_policies: 0 }]), []);
  assert.deepEqual(cumulativeCpa([{ net_spend_cents: 1000, issued_policies: 0 }, { net_spend_cents: 1000, issued_policies: 1 }, { net_spend_cents: 2000, issued_policies: 1 }]), [20, 20]);
});

test("a stage counts what its drill lists", () => {
  const line = { leads_received: 10, dialable_leads: 9, undialable_leads: 1, dialed_leads: 5, contacted_leads: 3, quoted_leads: 2, applied_leads: null, applications: 2, issued_policies: 1 };
  assert.equal(stageCount(line, "applied"), 2, "before the funnel update, applications stand in");
  assert.equal(stageCount(line, "dialed"), 5);
});

test("the page is round 7's: chart first, the kit's charts, no donut, no notice cards", () => {
  const page = read("components/app/true-cpa-workspace.tsx");
  assert.match(read("app/app/(shell)/true-cpa/page.tsx"), /<ReportsPage view="cpa" show="chart"/);
  assert.match(read("app/app/(shell)/true-cpa/leads/page.tsx"), /showOf\(query, "table"\)/, "the leads open on the table");
  for (const chart of [/<BarList/, /<BarSeries/, /<LineSeries/]) assert.match(page, chart);
  assert.match(read("components/app/campaign-comparison-workspace.tsx"), /pair: stage\.b_count/, "Compare's chart is paired bars");
  assert.doesNotMatch(page, /DonutChart|<Callout/);
  assert.match(page, /trend=\{/, "the cards carry their own small chart");
  assert.doesNotMatch(page, /valueTone=/, "the cards' figures are plain");
});
