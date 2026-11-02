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
  assert.deepEqual(COMMISSIONS_STEPS.map((step) => step.key), ["statements", "ledger", "discrepancies", "attribution", "reconciliation", "rates"]);
  const at = { "/app/statements": "statements", "/app/ledger": "ledger", "/app/discrepancies": "discrepancies", "/app/attribution": "attribution", "/app/producer-reconciliation": "reconciliation", "/app/my-pay": "reconciliation", "/app/rate-card": "rates" };
  for (const [path, step] of Object.entries(at)) assert.equal(commissionsStepOf(path), step, path);
  assert.equal(commissionsStepOf("/app/statements/abc"), null, "a statement's own page is a record");
  assert.equal(commissionsStepLabel("reconciliation", "/app/my-pay"), "My pay");
});

test("each page renders inside the frame under its own gate, with no title of its own", () => {
  const pages = { statements: "statements", ledger: "ledger", discrepancies: "discrepancies", attribution: "attribution", "producer-reconciliation": "reconciliation", "my-pay": "reconciliation", "rate-card": "rates" };
  for (const [route, step] of Object.entries(pages)) {
    const page = read(`app/app/(shell)/${route}/page.tsx`);
    assert.match(page, new RegExp(`<CommissionsPage\\s+step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, route);
  }
  // The ledger's three views each sit in the frame.
  assert.equal((read("app/app/(shell)/ledger/page.tsx").match(/<CommissionsPage step="ledger"/g) ?? []).length, 3);
  for (const board of ["components/app/agency/attribution-board.tsx", "components/app/agency/reconciliation-board.tsx"]) assert.doesNotMatch(read(board), /<PageHeader\b/, board);
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
  assert.deepEqual(tree(items.filter((i) => i.key !== "commissions.my_pay").map((i) => i.key)), ["book.statements"]);
  assert.deepEqual(tree(["book.ledger", "commissions.my_pay"]), ["book.ledger"], "a producer with the ledger");
  assert.deepEqual(tree(["commissions.my_pay"]), ["commissions.my_pay"], "a producer without it");
  assert.match(read("components/app/agent-sidebar.tsx"), /commissionsStepOf\(href\) && commissionsStepOf\(pathname\)/);
});
