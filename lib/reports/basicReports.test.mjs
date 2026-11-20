// Reports for the Basic plan's modules (owner 2026-11-19: "more reports, since there are more modules available for
// Basic"): Lead sources (vendors and campaigns) and Callbacks kept. Their gates, held in the source, plus the keep
// rule. DB-free and network-free.
// Run with: node --experimental-strip-types --test lib/reports/basicReports.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { callbackOutcome, callbackResults, keepRateText } from "./callbackResultsCore.ts";
import { leadSourcesHref, leadSourcesTabOf, rateText, speedText } from "./leadSourcesView.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SOURCES = "app/app/(shell)/source-results/page.tsx";
const CALLBACKS = "app/app/(shell)/callback-results/page.tsx";

/** The plans' feature lists, as the acceptance check states them (scripts/verify-entitlements.mjs). */
function planFeatures() {
  const source = read("scripts/verify-entitlements.mjs");
  const block = source.slice(source.indexOf("const EXPECTED_FEATURES"), source.indexOf("};", source.indexOf("const EXPECTED_FEATURES")));
  const out = {};
  for (const [, code, list] of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) out[code] = [...list.matchAll(/"([a-z_]+)"/g)].map(([, key]) => key);
  return out;
}

function menuItem(key) {
  const line = read("lib/menu/definition.ts").split("\n").find((l) => l.includes(`key: "${key}"`));
  assert.ok(line, `menu item ${key}`);
  return line;
}

test("both reports are Reports views with their own address and menu key", () => {
  const views = read("lib/reports/views.ts");
  assert.match(views, /\{ key: "sources", menuKey: "insight\.lead-sources", label: "Lead sources",[^}]*href: "\/app\/source-results", sharesPeriod: true \}/);
  assert.match(views, /\{ key: "callbacks", menuKey: "insight\.callbacks", label: "Callbacks kept",[^}]*href: "\/app\/callback-results", sharesPeriod: true \}/);
  for (const route of [SOURCES, CALLBACKS]) {
    assert.ok(existsSync(join(process.cwd(), route)), route);
    assert.ok(existsSync(join(process.cwd(), route.replace("page.tsx", "loading.tsx"))), `${route}: its loading frame`);
  }
  assert.match(read("components/app/reports/reports-rail.tsx"), /sources: Package, callbacks: CalendarCheck/);
});

test("each report is gated on the module it reports on, in the menu and on the page", () => {
  const sources = menuItem("insight.lead-sources");
  assert.match(sources, /required_feature: "outbound_dialing", required_roles: \["owner", "producer"\]/);
  assert.match(sources, /groupLink: true, sidebar_fallback_for: "insight\.sales-performance"/);
  const callbacks = menuItem("insight.callbacks");
  assert.match(callbacks, /required_feature: "callback_calendar", required_roles: \["owner", "producer", "assistant"\]/);
  assert.match(callbacks, /groupLink: true, sidebar_fallback_for: "insight\.sales-performance"/);

  const sourcesPage = code(read(SOURCES));
  assert.match(sourcesPage, /guardPage\("outbound_dialing"\)/);
  assert.match(sourcesPage, /actAsPage\(guard, \["owner", "producer"\]\)/);
  const callbacksPage = code(read(CALLBACKS));
  assert.match(callbacksPage, /guardPage\("callback_calendar"\)/);
  assert.match(callbacksPage, /actAsPage\(guard, \["owner", "producer", "assistant"\]\)/);
  for (const page of [sourcesPage, callbacksPage]) assert.match(page, /<ReportsPage view="[a-z]+" info=\{INFO\} show="chart">/);
});

test("Basic has both modules and Ledger has neither, so Ledger never sees them", () => {
  const plans = planFeatures();
  for (const feature of ["outbound_dialing", "callback_calendar"]) {
    assert.ok(plans.pro.includes(feature), `Basic (pro) holds ${feature}`);
    assert.ok(plans.advance.includes(feature), `Advanced holds ${feature}`);
    assert.ok(!plans.basic.includes(feature), `Ledger (basic) does not hold ${feature}`);
  }
});

test("lead spend shows only with True CPA, and an agency's narrow session is refused", () => {
  const page = code(read(SOURCES));
  assert.match(page, /const trueCpa = hasFeature\(guard\.entitlement, "true_cpa"\);\s*const money = trueCpa;/);
  assert.match(page, /if \(\(await scopeFor\(guard\.context\)\) !== null\) return <RoleGateNotice reason="agency"/);
  assert.ok(read("lib/menu/definition.ts").includes('"insight.true-cpa", "insight.lead-sources", "partners.review"'), "agency-owner-only in the menu");
  const view = code(read("components/app/reports/lead-sources-report.tsx"));
  assert.match(view, /\{money && <StatTile label="Net spend"/);
  assert.match(view, /\{money && <th className="text-right">Net spend<\/th>\}/);
  assert.doesNotMatch(view, /effective_cost_per_issued_policy_cents/, "cost per issued policy stays True CPA's");
});

test("a solo agent gets no By person: nobody to compare with", () => {
  const page = code(read(CALLBACKS));
  assert.match(page, /isSoloWorkspace\(guard\.context\.tenantId\)/);
  assert.match(page, /const team = !solo && \(guard\.role === "owner" \|\| \(scope !== null && scope\.length > 1\)\);/);
  assert.match(page, /const tab: CallbackTab = team && asked === "people" \? "people" : "weeks";/);
  assert.match(code(read("components/app/reports/callback-results-report.tsx")), /if \(!team\) return null;/);
});

test("no notices, no donuts, Title Case tabs", () => {
  for (const file of ["components/app/reports/lead-sources-report.tsx", "components/app/reports/callback-results-report.tsx"]) {
    const source = code(read(file));
    assert.doesNotMatch(source, /<(Callout|PageAlert|DonutChart)\b/, file);
    assert.doesNotMatch(source, /role="(alert|note|status)"/, file);
    for (const [, label] of source.matchAll(/\{ key: "[a-z]+" as const, label: "([^"]+)"/g)) {
      assert.match(label, /^([A-Z][a-z]*)( [A-Z][a-z]*)*$/, `${file}: tab "${label}" in Title Case`);
    }
  }
});

test("a callback's outcome and the keep rate", () => {
  assert.equal(callbackOutcome({ status: "completed", missedAt: "2026-11-01T00:00:00Z" }), "kept");
  assert.equal(callbackOutcome({ status: "scheduled", missedAt: "2026-11-01T00:00:00Z" }), "missed");
  assert.equal(callbackOutcome({ status: "missed", missedAt: null }), "missed");
  assert.equal(callbackOutcome({ status: "cancelled", missedAt: null }), "cancelled");
  assert.equal(callbackOutcome({ status: "due", missedAt: null }), "open");
  assert.equal(keepRateText({ kept: 3, missed: 1 }), "3 of 4 kept");
  assert.equal(keepRateText({ kept: 8, missed: 2 }), "80% kept");
  assert.equal(keepRateText({ kept: 0, missed: 0 }), "—");

  const fact = (day, status, extra = {}) => ({ assignedTo: "u1", status, day, completedVia: null, missedAt: null, ...extra });
  const results = callbackResults([
    fact("2026-11-02", "completed", { completedVia: "call" }),
    fact("2026-11-03", "completed", { missedAt: "2026-11-02T22:00:00Z" }),
    fact("2026-11-10", "missed", { assignedTo: null }),
    fact("2026-11-12", "scheduled"),
    fact("2026-10-01", "completed"),
  ], { from: "2026-11-01", to: "2026-11-14" }, { u1: "Avery" });
  assert.deepEqual({ booked: results.total.booked, kept: results.total.kept, onCall: results.total.keptOnCall, late: results.total.keptLate, missed: results.total.missed, open: results.total.open }, { booked: 4, kept: 2, onCall: 1, late: 1, missed: 1, open: 1 });
  assert.equal(results.weeks.reduce((sum, w) => sum + w.booked, 0), 4, "every callback in the period lands in one week");
  assert.deepEqual(results.people.map((p) => [p.label, p.booked]), [["Avery", 3], ["Nobody", 1]]);
});

test("the lead sources address and words", () => {
  assert.equal(leadSourcesTabOf("campaigns"), "campaigns");
  assert.equal(leadSourcesTabOf("nonsense"), "vendors");
  assert.equal(leadSourcesHref("vendors", null), "/app/source-results");
  assert.equal(leadSourcesHref("campaigns", { from: "2026-08-01", to: "2026-10-30" }, "table"), "/app/source-results?tab=campaigns&from=2026-08-01&to=2026-10-30&show=table");
  assert.equal(rateText(3, 12, "contacted"), "3 of 12");
  assert.equal(rateText(21, 42, "contacted"), "50% contacted");
  assert.equal(rateText(0, 0, "contacted"), "—");
  assert.equal(speedText(45), "45 s");
  assert.equal(speedText(600), "10 min");
  assert.equal(speedText(null), "—");
});
