// LA-6.7 (Notion sprint, Module 6 — Compliance) · the compliance dashboard.
// Run with: node --experimental-strip-types --test lib/compliance/dashboard.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dashboardAlerts, dashboardTiles, TILE_KEYS } from "./dashboardCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-10-15T12:00:00Z");
const figures = { called_numbers: 1901, consented_called_numbers: 1842, dnc_active: 412, campaigns_active: 4, campaigns_scrubbed_30d: 3, transfers_accepted: 100, transfers_screened_before: 94, deletions_open: 1, holds_active: 38, last_run_held: null, purge_scheduled: false, unruled_types: [] };
const gap = (category, numbers, count, und = 0) => ({ category, numbers, count, undeterminedCount: und, undeterminedReason: null });
const gaps = [gap("called_after_dnc", 3, 5), gap("outside_legal_hours", 0, 0), gap("calls_without_consent", 59, 120)];

test("the spec's screen: the top zone in severity order", () => {
  const alerts = dashboardAlerts({
    complaints: [{ id: "c1", channel: "doi", regulatorState: "TX", tone: "red", daysLeft: 6, label: "Respond within 6 days" }],
    gaps,
    expiries: [{ kind: "eo", name: "Markel", expiresAt: "2026-11-07" }, { kind: "licence", name: "TX", expiresAt: "2026-11-25" }, { kind: "licence", name: "FL", expiresAt: "2027-06-01" }],
    hasEo: true,
    deadlineCoverage: null,
    now: NOW,
  });
  assert.deepEqual(alerts.map((a) => a.text), [
    "TX DOI complaint — respond within 6 days",
    "3 numbers called after a DNC entry — fix today",
    "E&O insurance expires in 23 days",
    "Texas licence expires in 41 days",
  ]);
});

test("an overdue DOI complaint and any call outside legal hours outrank everything", () => {
  const alerts = dashboardAlerts({
    complaints: [{ id: "c1", channel: "doi", regulatorState: "TX", tone: "overdue", daysLeft: -2, label: "Overdue by 2 days" }],
    gaps: [gap("outside_legal_hours", 1, 2), gap("called_after_dnc", 1, 1)],
    expiries: [], hasEo: true, deadlineCoverage: null, now: NOW,
  });
  assert.deepEqual(alerts.slice(0, 2).map((a) => a.severity), ["incident", "incident"]);
  assert.match(alerts[0].text, /past the response deadline/);
});

test("a non-zero out-of-hours count is an incident, not a statistic", () => {
  const tiles = dashboardTiles({ figures, gaps: [gap("outside_legal_hours", 1, 2)] });
  const t = tiles.find((x) => x.key === "outside_hours");
  assert.equal(t.tone, "danger");
  assert.match(t.footnote, /incident/);
  assert.equal(dashboardTiles({ figures, gaps }).find((x) => x.key === "outside_hours").tone, undefined);
});

test("absent, not guessed: an uncomputable figure reads 'not configured' with a fix link — never zero", () => {
  const tiles = dashboardTiles({ figures: null, gaps: null });
  assert.equal(tiles.length, TILE_KEYS.length);
  for (const t of tiles) {
    assert.equal(t.value, null, t.key);
    assert.equal(t.footnote, t.notConfigured, t.key);
    assert.ok(t.href && t.notConfigured, t.key);
  }
  // With window rules missing, every call is undetermined: still not a zero that reads as clear.
  const und = dashboardTiles({ figures, gaps: [gap("outside_legal_hours", 0, 0, 19433)] }).find((x) => x.key === "outside_hours");
  assert.equal(und.tone, "warning");
  assert.match(und.footnote, /19,433 could not be checked/);
  assert.match(read("app/app/(shell)/compliance/page.tsx"), /value=\{t\.value \?\? "Not configured"\}/);
});

test("the spec's standing figures, each opening the rows behind it", () => {
  const tiles = dashboardTiles({ figures, gaps });
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  assert.equal(by.consent_coverage.value, "1,842 of 1,901");
  assert.equal(by.consent_coverage.footnote, "↳ 59 missing");
  assert.equal(by.campaigns_scrubbed.value, "3 of 4");
  assert.equal(by.outside_hours.value, "0");
  assert.equal(by.dnc_size.value, "412 numbers");
  assert.equal(by.screened_before_transfer.value, "94%");
  assert.equal(by.deletions_and_holds.value, "1 · 38");
  for (const t of tiles) assert.match(t.href, /^\/app\//, t.key);
  assert.match(read("app/app/(shell)/compliance/page.tsx"), /action=\{<Link href=\{t\.href\}/);
});

test("every figure comes from its owning module; the dashboard collects nothing new", () => {
  const sql = read("supabase/migrations/20261015160000_la_6_7_dashboard_figures.sql");
  assert.doesNotMatch(sql, /create table|insert into|update public\./i);
  const loader = read("lib/compliance/dashboard.ts");
  assert.match(loader, /bookGapScan\(viewer, \{\}, \{ log: false, numbers: false \}\)/, "the gap figures are LA-6.3's");
  assert.match(loader, /listComplaints\(viewer, \{ open: true \}\)/);
  assert.match(loader, /from\("licenses"\)/);
  assert.match(loader, /from\("eo_policies"\)/);
});

test("owners and producers only; the monthly email can be switched off", () => {
  assert.match(read("app/app/(shell)/compliance/page.tsx"), /if \(!\["owner", "producer"\]\.includes\(guard\.role\)\)/);
  const cron = read("app/api/cron/compliance-monthly/route.ts");
  assert.match(cron, /if \(settings && settings\.dashboard_monthly_email === false\) continue;/);
  assert.match(cron, /dedupeKey: `compliance-monthly-\$\{monthKey\}-\$\{tenantId\}-\$\{person\.id\}`/);
  assert.ok(!AGENT_API_POLICIES.some((p) => p.sourceFile.includes("compliance/dashboard")), "a page, not an open API");
});
