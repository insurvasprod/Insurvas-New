// Commissions, one page (owner 2026-11-02, "the same thing for commissions"): six steps of one frame with a rail;
// My pay is the Reconciliation step for a producer.
// Run with: node --experimental-strip-types --test lib/commissions/commissionsFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMMISSIONS_STEPS, commissionsStepLabel, commissionsStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

test("every Commissions address is a step, in the order money moves", () => {
  // Two steps since 2026-11-05 (owner): the ledger went to Book of business, Hierarchy & overrides to Reports.
  assert.deepEqual(COMMISSIONS_STEPS.map((step) => step.key), ["discrepancies", "reconciliation"]);
  assert.equal(commissionsStepOf("/app/ledger"), null, "the ledger is Book of business'");
  assert.equal(commissionsStepOf("/app/hierarchy"), null, "Hierarchy is a Reports view");
  const at = { "/app/discrepancies": "discrepancies", "/app/producer-reconciliation": "reconciliation", "/app/my-pay": "reconciliation" };
  // Statements are Book of business › Files and the Attribution queue is Needs you's Credit (owner 2026-11-02).
  assert.equal(commissionsStepOf("/app/statements"), null);
  assert.equal(commissionsStepOf("/app/attribution"), null);
  assert.match(read("app/app/(shell)/statements/page.tsx"), /<DataInPage\s+step="files"\s+title="Statements"/);
  // The Rate card is Book of business › Setup now (owner 2026-11-02); its old address redirects there.
  assert.equal(commissionsStepOf("/app/rate-card"), null);
  assert.match(read("app/app/(shell)/rate-card/page.tsx"), /redirect\("\/app\/book-setup"\)/);
  for (const [path, step] of Object.entries(at)) assert.equal(commissionsStepOf(path), step, path);
  assert.equal(commissionsStepLabel("reconciliation", "/app/my-pay"), "My pay");
});

test("each page renders inside the frame under its own gate, with no title of its own", () => {
  const pages = { discrepancies: "discrepancies", "producer-reconciliation": "reconciliation", "my-pay": "reconciliation" };
  for (const [route, step] of Object.entries(pages)) {
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, new RegExp(`<CommissionsPage\\s+step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, route);
  }
  // The ledger's three views each sit in the Book of business frame (2026-11-05).
  assert.equal((read("app/app/(shell)/ledger/page.tsx").match(/<DataInPage step="ledger"/g) ?? []).length, 3);
  assert.doesNotMatch(read("components/app/agency/reconciliation-board.tsx"), /<PageHeader\b/);
});

test("the rail opens each step by its route's rule, and counts only for the people who work the queues", () => {
  const frame = read("components/app/commissions/commissions-page.tsx");
  assert.match(frame, /item\.key === "reconciliation" && !payKeeper \? \{ \.\.\.item, \.\.\.MY_PAY \}/);
  assert.match(frame, /countsUrl: "\/api\/app\/commissions\/steps"/);
  const route = read("app/api/app/commissions/steps/route.ts");
  assert.match(route, /const ROLES = \["owner", "bookkeeper"\] as const;/);
  assert.match(route, /requireFeatureRole\("statement_ingestion", ROLES\)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/commissions\/steps\/route\.ts", featureKey: "statement_ingestion"/);
});

test("the sidebar shows one Commissions link", () => {
  const items = AGENT_MENU.flatMap((section) => section.items).filter((item) => item.section === "Commissions");
  for (const entry of items) assert.equal(entry.groupLink, true, entry.key);
  const tree = (keys) => buildSidebarTree([{ id: "c", label: "Commissions", items: items.filter((i) => keys.includes(i.key)) }]).groups.find((g) => g.label === "Commissions").items.map((i) => i.key);
  assert.deepEqual(tree(items.filter((i) => i.key !== "commissions.my_pay").map((i) => i.key)), ["book.discrepancies"]);
  assert.deepEqual(tree(["commissions.my_pay"]), ["commissions.my_pay"], "a producer gets My pay");
  assert.ok(!items.some((i) => i.key === "book.ledger" || i.key === "team.hierarchy"), "the ledger and Hierarchy left (2026-11-05)");
  assert.match(read("components/app/agent-sidebar.tsx"), /commissionsStepOf\(href\) && commissionsStepOf\(pathname\)/);
});
