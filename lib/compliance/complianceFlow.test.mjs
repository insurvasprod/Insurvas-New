// Compliance in one page (2026-10-30, canvas "M6 · Compliance (one page)"): the six Compliance pages are steps of
// one frame with a rail, the Leads in treatment. Run with: node --experimental-strip-types --test lib/compliance/complianceFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMPLIANCE_STEPS, complianceStepOf } from "./steps.ts";
import { dashboardAlerts, dashboardTiles } from "./dashboardCore.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const ROUTES = { overview: "compliance", dnc: "tcpa", consent: "consent", complaints: "complaints", deletions: "deletion-requests", evidence: "evidence-report" };

test("every step keeps its old address and renders inside the frame, under its own gate", () => {
  for (const step of COMPLIANCE_STEPS) {
    assert.equal(step.href, `/app/${ROUTES[step.key]}`);
    assert.equal(complianceStepOf(step.href), step.key);
    const page = read(`app/app/(shell)/${ROUTES[step.key]}/page.tsx`);
    assert.match(page, new RegExp(`<ComplianceFlowPage step="${step.key}"`), step.key);
    assert.match(page, /guardPage\(/, `${step.key} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, `${step.key}: the frame draws the one title`);
  }
  // Settings stays a Settings page, not a step.
  assert.equal(complianceStepOf("/app/compliance/settings"), null);
});

test("the workspaces put their tabs and actions in the frame's row, not a header of their own", () => {
  for (const file of ["components/app/suppression-workspace.tsx", "components/app/consent-locker-workspace.tsx", "components/app/compliance/complaints-board.tsx", "components/app/compliance/deletion-requests-board.tsx"]) {
    const source = read(file);
    assert.match(source, /<ComplianceSlot slot="lead">/, file);
    assert.match(source, /<ComplianceSlot slot="corner">/, file);
    assert.doesNotMatch(source, /<PageHeader\b/, file);
    assert.match(source, /<NextUp\b/, `${file} opens on one next-up line`);
  }
});

test("the sidebar shows one Compliance entry; the steps stand in only for someone who cannot open Overview", () => {
  const items = AGENT_MENU.find((section) => section.id === "compliance").items;
  for (const entry of items.filter((i) => i.key !== "compliance.dashboard")) assert.equal(entry.sidebar_fallback_for, "compliance.dashboard", entry.key);
  const owner = buildSidebarTree([{ id: "compliance", label: "Compliance", items }]);
  assert.deepEqual(owner.groups.find((g) => g.label === "Compliance").items.map((i) => i.key), ["compliance.dashboard"]);
  // Owner 2026-10-30: no "Overview" row under Compliance — the group is one link straight to the page.
  assert.equal(items.find((i) => i.key === "compliance.dashboard").groupLink, true);
  assert.match(read("components/app/agent-sidebar.tsx"), /group\.items\.length === 1 && group\.items\[0\]\.groupLink \?/);
  const setter = buildSidebarTree([{ id: "compliance", label: "Compliance", items: items.filter((i) => i.key === "compliance.tcpa") }]);
  assert.deepEqual(setter.groups.find((g) => g.label === "Compliance").items.map((i) => i.key), ["compliance.tcpa"]);
});

test("Overview's problems open their own fix", () => {
  const alerts = dashboardAlerts({
    complaints: [{ id: "c1", channel: "doi", regulatorState: "TX", tone: "overdue", daysLeft: -2, label: "Overdue by 2 days" }],
    gaps: [{ category: "called_after_dnc", numbers: 4, count: 9 }, { category: "outside_legal_hours", numbers: 1, count: 2, undeterminedCount: 0 }],
    expiries: [{ kind: "licence", name: "FL", expiresAt: "2026-10-20" }],
    deadlineCoverage: { missing: ["GA"], licensed: 3, sentence: "No response days set for GA." },
    now: new Date("2026-10-15T12:00:00Z"),
  });
  const href = Object.fromEntries(alerts.map((a) => [a.key, a.href]));
  assert.equal(href.complaints_overdue, "/app/complaints?open=c1");
  assert.equal(href.called_after_dnc, "/app/evidence-report?focus=called_after_dnc");
  assert.equal(href.outside_hours, "/app/evidence-report?focus=outside_legal_hours");
  assert.equal(href.licence_FL, "/app/appointments?tab=licences&state=FL");
  assert.equal(href.deadlines_unset, "/app/compliance/settings#deadlines");
  const tiles = dashboardTiles({ figures: { called_numbers: 10, consented_called_numbers: 8, campaigns_active: 0, campaigns_scrubbed_30d: 0, dnc_active: 1, transfers_accepted: 0, transfers_screened_before: 0, deletions_open: 0, holds_active: 0, last_run_held: 0 }, gaps: [] });
  assert.equal(tiles.find((t) => t.key === "consent_coverage").href, "/app/evidence-report?focus=calls_without_consent");
  // The evidence view opens the focused finding.
  assert.match(read("components/app/compliance/evidence-report.tsx"), /focus && \(scan\.numbersByCategory\[focus\]/);
});

test("the rail's counts come from a registered, gated route", () => {
  const route = read("app/api/app/compliance/steps/route.ts");
  assert.match(route, /requireFeatureRole\("tcpa_checker", ROLES/);
  assert.match(route, /refuseNarrowInAgency/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/compliance\/steps\/route\.ts", featureKey: "tcpa_checker"/);
});
