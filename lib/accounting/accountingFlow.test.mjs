// Accounting, one page (owner 2026-11-02, "like Data in"): six steps of one frame with a rail; Vendor returns is
// Vendor bills' Returns tab and My balance is the Splits step for a producer.
// Run with: node --experimental-strip-types --test lib/accounting/accountingFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACCOUNTING_STEPS, accountingStepLabel, accountingStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const shell = (route) => read(`app/app/(shell)/${route}/page.tsx`);

test("every Accounting address is a step, in the order a month runs", () => {
  assert.deepEqual(ACCOUNTING_STEPS.map((step) => step.key), ["pnl", "bank", "bills", "expenses", "splits", "tax"]);
  const at = { "/app/pnl": "pnl", "/app/bank": "bank", "/app/vendor-bills": "bills", "/app/vendor-returns": "bills", "/app/invoices": "bills", "/app/expenses": "expenses", "/app/producer-splits": "splits", "/app/my-balance": "splits", "/app/tax": "tax" };
  for (const [path, step] of Object.entries(at)) assert.equal(accountingStepOf(path), step, path);
  assert.equal(accountingStepOf("/app/accounting/settings"), null, "Accounting settings stay a Settings page");
  assert.equal(accountingStepLabel("splits", "/app/my-balance"), "My balance");
  assert.equal(accountingStepLabel("splits", "/app/producer-splits"), "Producer splits");
});

test("each page renders inside the frame under its own gate, with no title of its own", () => {
  const pages = { pnl: "pnl", bank: "bank", expenses: "expenses", "producer-splits": "splits", "my-balance": "splits", tax: "tax" };
  for (const [route, step] of Object.entries(pages)) {
    const page = shell(route);
    assert.match(page, new RegExp(`<AccountingPage step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, route);
  }
  const bills = read("components/app/lead-sources/pages.tsx");
  assert.match(bills, /<AccountingPage step="bills">/);
  assert.match(bills, /<SourceTabs label="Vendor bills" tabs=\{tabs\}/, "Returns stays a tab of Vendor bills");
});

test("the rail opens each step by its route's rule, and folds the two pages", () => {
  const frame = read("components/app/accounting/accounting-page.tsx");
  assert.match(frame, /keeper = money\.entitled && actAsPage\(money, \["owner", "bookkeeper"\]\)/);
  assert.match(frame, /producer = money\.entitled && actAsPage\(money, \["producer"\]\)/);
  assert.match(frame, /item\.key === "splits" && !keeper\) return \{ \.\.\.item, \.\.\.MY_BALANCE \}/);
  assert.match(frame, /countsUrl: "\/api\/app\/accounting\/steps"/);
  const route = read("app/api/app/accounting/steps/route.ts");
  assert.match(route, /requireFeatureRole\("profit_and_loss", ROLES\)/);
  assert.match(route, /const ROLES = \["owner", "bookkeeper"\] as const;/);
  assert.doesNotMatch(route, /_cents"\)\s*\.select|sum\(/, "counts only, never an amount");
});

test("the sidebar shows one Accounting link", () => {
  const items = AGENT_MENU.flatMap((section) => section.items).filter((item) => item.section === "Accounting");
  for (const entry of items) assert.equal(entry.groupLink, true, entry.key);
  const tree = (keys) => buildSidebarTree([{ id: "a", label: "Accounting", items: items.filter((i) => keys.includes(i.key)) }]).groups.find((g) => g.label === "Accounting").items.map((i) => i.key);
  const keeper = ["accounting.invoices", "insight.vendor-returns", "accounting.expenses", "accounting.producer_splits", "accounting.bank", "accounting.pnl", "accounting.tax"];
  assert.deepEqual(tree(keeper), ["accounting.pnl"]);
  assert.deepEqual(tree(["insight.vendor-returns", "accounting.my_balance"]), ["insight.vendor-returns"], "a producer with returns");
  assert.deepEqual(tree(["accounting.my_balance"]), ["accounting.my_balance"], "a producer without returns");
  assert.match(read("components/app/agent-sidebar.tsx"), /accountingStepOf\(href\) && accountingStepOf\(pathname\)/);
});
