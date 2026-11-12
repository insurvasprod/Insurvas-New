// Accounting, one page (owner 2026-11-02, "like Data in"): six steps of one frame with a rail; Vendor returns is
// Vendor bills' Returns tab and My balance is the Splits step for a producer.
// Run with: node --experimental-strip-types --test lib/accounting/accountingFlow.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ACCOUNTING_STEPS, accountingStepHref, accountingStepLabel, accountingStepOf } from "./steps.ts";
import { AGENT_MENU } from "../menu/definition.ts";
import { buildSidebarTree } from "../menu/sidebar.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const shell = (route) => read(`app/app/(shell)/${route}/page.tsx`);

test("To do first, then the steps grouped as the money moves (round 7, mockups-r7/accounting.html 0·B)", () => {
  assert.deepEqual(ACCOUNTING_STEPS.map((step) => step.key), ["todo", "bank", "bills", "expenses", "splits", "producerPayouts", "payouts", "pnl", "tax"]);
  assert.deepEqual([...new Set(ACCOUNTING_STEPS.map((step) => step.group).filter(Boolean))], ["Money in", "Money out", "Your books"]);
  assert.deepEqual(ACCOUNTING_STEPS.filter((step) => step.elsewhere).map((step) => [step.key, step.elsewhere]), [["producerPayouts", "Commissions"], ["payouts", "Commissions"]], "paying producers and partners opens in Commissions");
  assert.ok(!ACCOUNTING_STEPS.some((step) => step.key === "commissionSplits"), "Commission splits left Accounting");
  const at = { "/app/accounting": "todo", "/app/pnl": "pnl", "/app/bank": "bank", "/app/vendor-bills": "bills", "/app/vendor-returns": "bills", "/app/invoices": "bills", "/app/expenses": "expenses", "/app/producer-splits": "splits", "/app/my-balance": "splits", "/app/tax": "tax" };
  for (const [path, step] of Object.entries(at)) assert.equal(accountingStepOf(path), step, path);
  assert.equal(accountingStepOf("/app/accounting/settings"), null, "Accounting settings stay a Settings page");
  assert.equal(accountingStepLabel("splits", "/app/my-balance"), "My balance");
  assert.equal(accountingStepLabel("splits", "/app/producer-splits"), "Producer splits");
});

test("each page renders inside the frame under its own gate, with no title of its own", () => {
  const pages = { pnl: "pnl", bank: "bank", expenses: "expenses", "producer-splits": "splits", "my-balance": "splits", tax: "tax" };
  for (const [route, step] of Object.entries(pages)) {
    const page = shell(route);
    assert.match(page, new RegExp(`<AccountingPage\\s+step="${step}"`), route);
    assert.match(page, /guardPage\(/, `${route} keeps its own gate`);
    assert.doesNotMatch(page, /<PageHeader\b/, route);
  }
  const bills = read("components/app/lead-sources/pages.tsx");
  assert.match(bills, /<AccountingPage\s+step="bills"/);
  assert.match(bills, /<ViewTabs label="Vendor bills"[\s\S]*tabs=\{tabs\}/, "Returns stays a tab of Vendor bills, in the sub-page bar (UI-CONSISTENCY §8b)");
});

test("a record under a step is that step: the rail, the sidebar and the trail stay on it (foundation pass 2026-11-03)", () => {
  const under = { "/app/pnl/entries": "pnl", "/app/vendor-bills/new": "bills", "/app/vendor-bills/0b7c4f1e-1d2a-4c3b-9e8f-1a2b3c4d5e6f": "bills", "/app/expenses/new": "expenses", "/app/producer-splits/0b7c4f1e-1d2a-4c3b-9e8f-1a2b3c4d5e6f": "splits", "/app/tax/payee/vendor/0b7c4f1e-1d2a-4c3b-9e8f-1a2b3c4d5e6f": "tax" };
  for (const [path, step] of Object.entries(under)) assert.equal(accountingStepOf(path), step, path);
  assert.equal(accountingStepOf("/app/pnlx"), null, "a look-alike address is not a step");
  assert.equal(accountingStepOf("/app/taxonomy"), null);
  assert.equal(accountingStepHref("splits", "/app/my-balance"), "/app/my-balance");
  assert.equal(accountingStepHref("bills", "/app/vendor-bills/x"), "/app/vendor-bills");
  assert.match(read("components/ui/page-trail.tsx"), /const below = pathname !== stepHref && title\.trim\(\) && title !== label;\n\s+return <Breadcrumbs crumbs=\{\[\{ label: "Accounting" \}, \{ label, href: stepHref \}, \.\.\.\(below \? \[\{ label: title \}\] : \[\]\)\]\} \/>;/);
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
  const keeper = ["accounting.todo", "accounting.invoices", "insight.vendor-returns", "accounting.expenses", "accounting.producer_splits", "accounting.bank", "accounting.pnl", "accounting.tax"];
  assert.deepEqual(tree(keeper), ["accounting.todo"], "Accounting opens on To do (round 7)");
  assert.deepEqual(tree(["insight.vendor-returns", "accounting.my_balance"]), ["insight.vendor-returns"], "a producer with returns");
  assert.deepEqual(tree(["accounting.my_balance"]), ["accounting.my_balance"], "a producer without returns");
  assert.match(read("components/app/agent-sidebar.tsx"), /accountingStepOf\(href\) && accountingStepOf\(pathname\)/);
});

test("To do and the rail's counts read one list; Accounting settings sits at the rail's foot (round 7)", () => {
  const page = shell("accounting");
  assert.match(page, /<AccountingPage\s+step="todo"/);
  assert.match(page, /guardPage\("profit_and_loss"\)/);
  assert.match(page, /actAsPage\(money, \["owner", "bookkeeper"\]\)/);
  const route = read("app/api/app/accounting/steps/route.ts");
  assert.match(route, /loadTodo\(tenantId/, "a badge and the To do page never disagree");
  const frame = read("components/app/accounting/accounting-page.tsx");
  assert.match(frame, /open\.add\("todo"\)/);
  assert.match(frame, /foot, collapsed:/);
  assert.doesNotMatch(frame, /meta=\{facts/, "the title stands alone: nothing under it");
  assert.match(read("components/app/step-frame/step-rail.tsx"), /elsewhere\?: string/);
});
