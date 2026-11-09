// The Team group rearranged (owner 2026-11-03, "the team should be rearranged somewhere else"): Producers is the
// second step of Home › Agency, Hierarchy & overrides a Commissions step; the rest of the old group went where each
// belongs. Keys, gates and addresses kept.
// Run with: node --experimental-strip-types --test lib/agency/agencyFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AGENCY_STEPS, agencyStepHref, agencyStepLabel, agencyStepOf } from "./steps.ts";
import { COMMISSIONS_STEPS, commissionsStepOf } from "../commissions/steps.ts";
import { ACCOUNTING_STEPS, accountingStepOf } from "../accounting/steps.ts";
import { REPORTS_VIEWS, reportsViewOf } from "../reports/views.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { NAV_GROUPS, buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const shell = (route) => read(`app/app/(shell)/${route}/page.tsx`);
const items = AGENT_MENU.flatMap((section) => section.items);
const item = (key) => items.find((entry) => entry.key === key);
const ID = "0b7c4f1e-1d2a-4c3b-9e8f-1a2b3c4d5e6f";

test("Agency is three steps (Compare added 2026-11-07), and a producer's record, its carriers and the invite form are the Producers step", () => {
  assert.deepEqual(AGENCY_STEPS.map((step) => step.key), ["overview", "producers", "compare"]);
  const at = { "/app/agency": "overview", "/app/agency/compare": "compare", "/app/producers": "producers", [`/app/producers/${ID}`]: "producers", "/app/producers/invite": "producers", [`/app/producers/${ID}/carrier/${ID}`]: "producers" };
  for (const [path, step] of Object.entries(at)) assert.equal(agencyStepOf(path), step, path);
  assert.equal(agencyStepOf("/app/hierarchy"), null, "Hierarchy is a Reports view");
  assert.equal(agencyStepOf("/app/producer-payouts"), null, "Producer payouts is Accounting's");
  assert.equal(agencyStepOf("/app/producersx"), null, "a look-alike address is not a step");
  assert.equal(agencyStepLabel("producers"), "Producers");
  assert.equal(agencyStepHref("overview"), "/app/agency");
});

test("there is no Team group, and every old Team address lands where it belongs (owner 2026-11-03)", () => {
  assert.equal(AGENT_MENU.some((section) => section.label === "Team"), false);
  assert.equal(NAV_GROUPS.some((group) => group.section === "Team"), false);
  const moved = {
    "team.producers": ["Home", "/app/producers"],
    // Commissions from 2026-11-03, Reports since 2026-11-05 (owner: "Put hierarchy and overrides on reports").
    "team.hierarchy": ["Reports", "/app/hierarchy"],
    "team.routing": ["Leads", "/app/lead-routing"],
    "team.payouts": ["Accounting", "/app/producer-payouts"],
    "team.splits": ["Accounting", "/app/commission-splits"],
    "team.scorecards": ["Reports", "/app/producer-scorecards"],
    "team.review": ["Sales", "/app/application-review"],
  };
  for (const [key, [section, path]] of Object.entries(moved)) {
    assert.equal(item(key)?.section, section, key);
    assert.equal(item(key)?.path, path, `${key} keeps its address`);
    assert.ok(existsSync(join(process.cwd(), `app/app/(shell)${path.slice("/app".length)}/page.tsx`)), `${path} still renders`);
  }
  assert.equal(item("team.producers")?.sidebar_fallback_for, "home.agency", "the Agency link stands for Producers");
  assert.equal(commissionsStepOf("/app/hierarchy"), null, "no longer a Commissions step");
  assert.ok(!COMMISSIONS_STEPS.some((step) => step.href === "/app/hierarchy"));
  assert.equal(reportsViewOf("/app/hierarchy"), "hierarchy");
  assert.equal(REPORTS_VIEWS.find((view) => view.key === "hierarchy")?.menuKey, "team.hierarchy");
  assert.equal(accountingStepOf("/app/producer-payouts"), "producerPayouts");
  assert.equal(accountingStepOf(`/app/producer-statements/${ID}`), "producerPayouts", "a statement is a record of Producer payouts");
  assert.equal(accountingStepOf("/app/commission-splits/new"), "commissionSplits");
  assert.ok(ACCOUNTING_STEPS.some((step) => step.key === "producerPayouts") && ACCOUNTING_STEPS.some((step) => step.key === "commissionSplits"));
  assert.equal(reportsViewOf("/app/producer-scorecards"), "producers");
  assert.equal(REPORTS_VIEWS.find((view) => view.key === "producers")?.menuKey, "team.scorecards");
  assert.match(read("components/app/applications/applications-tabs.ts"), /hasFeature\(entitlement, "team_qa"\)\) tabs\.push\(\{ key: "review", label: "Application review", href: "\/app\/application-review" \}\)/);
  assert.match(shell("lead-routing"), /<LeadsInPage step="route"/, "Lead routing was already Leads in's Route step");
});

test("each page renders inside its new frame under its own gate, with no header of its own", () => {
  const framed = {
    agency: /<AgencyPage\s+step="overview"/,
    producers: /<AgencyPage\s+step="producers"/,
    "producers/[id]": /<AgencyPage\s+step="producers"/,
    "producers/invite": /<AgencyPage step="producers"/,
    "producers/[id]/carrier/[carrierId]": /<AgencyPage step="producers"/,
    hierarchy: /<ReportsPage\s+view="hierarchy"/,
    "producer-payouts": /<AccountingPage\s+step="producerPayouts"/,
    "commission-splits": /<AccountingPage\s+step="commissionSplits"/,
    "commission-splits/new": /<AccountingPage step="commissionSplits"/,
    "producer-scorecards": /<ReportsPage\s+view="producers"/,
    "application-review": /<ApplicationsHub view="review"/,
  };
  for (const [route, frame] of Object.entries(framed)) {
    const page = shell(route);
    assert.match(page, frame, route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, route);
  }
  for (const board of ["producers-roster", "hierarchy-board", "payouts-board", "splits-board", "scorecards-board", "statement-view", "producer-detail", "producer-carriers-tab", "invite-producer-form"]) {
    assert.doesNotMatch(read(`components/app/agency/${board}.tsx`), /<PageHeader\b/, `${board} draws no header of its own`);
  }
  // The dashboard keeps its own header only outside the frame (the /design/agency sample).
  assert.match(read("components/app/agency/agency-dashboard.tsx"), /<StepSlot id=\{slot\}>\{headerActions\}<\/StepSlot>/);
});

test("foundation: no side panels, pop-ups only to confirm, no notices, header buttons at most two plus More", () => {
  for (const board of ["splits-board", "review-board", "producer-carriers-tab", "payouts-board", "producers-roster", "producer-onboarding-tab", "invite-producer-form"]) {
    const source = read(`components/app/agency/${board}.tsx`);
    assert.doesNotMatch(source, /<DetailPanel\b|<Sheet\b/, `${board}: a form or a record is a page`);
    assert.doesNotMatch(source, /border-l-\[3px\]/, `${board}: no tinted notice`);
  }
  assert.doesNotMatch(read("components/app/agency/invite-producer-form.tsx"), /<Dialog\b/, "the invite is a page, not a pop-up");
  assert.ok(existsSync(join(process.cwd(), "app/app/(shell)/application-review/[id]/page.tsx")), "a review opens as its own page");
  assert.match(shell("producers"), /if \(invite === "1" && canManage\) redirect\("\/app\/producers\/invite"\)/, "the old ?invite=1 still lands");
  assert.match(read("components/app/agency/producer-detail.tsx"), /<MoreMenu items=\{\[/);
  assert.match(read("components/app/agency/producers-roster.tsx"), /href="\/app\/producers\?status=blocked"/, "a strip figure opens its rows");
});

test("the agency dashboard has no rail: Producers and every agency page are shortcuts on it, gated by the menu", () => {
  assert.doesNotMatch(read("components/app/agency/agency-page.tsx"), /StepFrame|StepRail|rail=/, "no side panel (owner 2026-11-03)");
  const board = read("components/app/agency/agency-dashboard.tsx");
  assert.match(board, /\{ key: "team\.producers", label: "Producers", href: "\/app\/producers"/, "Producers is the first tile");
  assert.match(board, /const tools = TOOLS\.filter\(\(tool\) => !offered \|\| offered\.has\(tool\.key\)\);/, "a tile only where the menu offers the page");
  assert.match(board, /<HomeAttention items=\{attention\} \/>/, "the agency's Needs you, drawn as Home's");
  assert.ok(board.includes("href={`/app/producers/${r.producerId}`}"), "a name opens the producer's record");
  for (const href of ["/app/producer-scorecards", "/app/hierarchy", "/app/producer-payouts", "/app/lapse-risk", "/app/producers"]) {
    assert.ok(board.includes(`: "${href}"}`), `a strip figure opens ${href}`);
  }
  assert.match(read("lib/agency/dashboardStore.ts"), /producerId: recordOf\.get\(r\.producerUserId\) \?\? null/);
  assert.equal(item("home.agency")?.icon, "building", "the agency has its own icon, not Home's");
});

test("the counts behind Needs you are counts only (never an amount), each under its page's own gate", () => {
  const route = read("app/api/app/agency/steps/route.ts");
  assert.match(route, /requireFeatureRole\("team_hierarchy", \["owner", "bookkeeper", "producer"\], \{ prefetchScope: true \}\)/);
  assert.match(route, /refuseProducerWithoutTitle\(auth\.context/);
  assert.match(route, /readRoster\(auth\.context\)/, "through the scoped store");
  assert.doesNotMatch(route, /_cents\b/, "counts only");
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/agency\/steps\/route\.ts", featureKey: "team_hierarchy"/);
  // Hierarchy left the Commissions rail for Reports (2026-11-05), and its count went with it.
  assert.doesNotMatch(read("app/api/app/commissions/steps/route.ts"), /team_hierarchy|readOverrides/);
});

test("the sidebar's Agency link stands for Producers, and the trail and the sidebar stay on a producer's record", () => {
  const home = items.filter((entry) => entry.section === "Home");
  const tree = (keys) => buildSidebarTree([{ id: "home", label: "Home", items: home.filter((i) => keys.includes(i.key)) }]).home.map((i) => i.key);
  assert.deepEqual(tree(["home.dashboard", "home.agency", "team.producers"]), ["home.dashboard", "home.agency"]);
  assert.deepEqual(tree(["home.dashboard", "team.producers"]), ["home.dashboard", "team.producers"], "no dashboard on the plan: Producers is Home's own link");
  assert.match(read("components/app/agent-sidebar.tsx"), /agencyStepOf\(href\) && agencyStepOf\(pathname\)/);
  assert.match(read("components/ui/page-trail.tsx"), /return <Breadcrumbs crumbs=\{\[\{ label: "Home" \}, \.\.\.agency, \{ label, href: stepHref \}, \.\.\.\(below \? \[\{ label: title \}\] : \[\]\)\]\} \/>;/);
});
