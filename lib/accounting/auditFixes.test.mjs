// LA-7 (Notion sprint, Module 7 — Accounting) · the money audit fixes (20261015620000), as behaviour.
// The SQL side is rehearsed with numeric fixtures on rolled-back temp copies; these pin the app side.
// Run with: node --experimental-strip-types --test lib/accounting/auditFixes.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { statement } from "./pnlCore.ts";
import { commissionTaxKey } from "./taxCore.ts";
import { ACCOUNTING_DEFAULTS, fromRow } from "./settingsCore.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const L = (section, entryType, amountCents) => ({ section, entryType, sourceType: null, sourceId: null, sourceName: null, amountCents, entries: 1 });

test("held commission is never money in or net: Aug 1000 + 800 advance, 150 earned, −400 chargeback, −25 fee, +50 held → $1,525.00", () => {
  const lines = [L("in", "advance", 180000), L("in", "earned", 15000), L("in", "chargeback", -40000), L("in", "fee", -2500), L("held", "held", 5000), L("acquisition", "lead_cost", -100000)];
  const s = statement(lines);
  assert.equal(s.inCents, 152500);
  assert.equal(s.heldCents, 5000, "shown apart");
  assert.equal(s.netProfitCents, 52500);
  assert.deepEqual(s.held.map((l) => l.entryType), ["held"]);
  // A reader still filing held under "in" is corrected too.
  assert.equal(statement([L("in", "advance", 100), L("in", "held", 50)]).inCents, 100);
});

test("tax: held is not income; a reversal is bucketed as what it reverses, an unattributed one by sign", () => {
  assert.equal(commissionTaxKey("held", null, 5000), null);
  assert.equal(commissionTaxKey("reversal", "held", -5000), null);
  assert.deepEqual(commissionTaxKey("reversal", "advance", -20000), { sourceValue: "advance", forced: null });
  assert.deepEqual(commissionTaxKey("reversal", "chargeback", 10000), { sourceValue: "chargeback", forced: null });
  assert.deepEqual(commissionTaxKey("reversal", null, 300), { sourceValue: "reversal", forced: "gross_receipts" });
  assert.deepEqual(commissionTaxKey("reversal", null, -300), { sourceValue: "reversal", forced: null });
  assert.deepEqual(commissionTaxKey("advance", null, 100), { sourceValue: "advance", forced: null });
});

test("the payout dispute tolerance is an LA-7.9 setting, default 0, read through fromRow", () => {
  assert.equal(ACCOUNTING_DEFAULTS.payoutDisputeToleranceCents, 0);
  assert.equal(fromRow({ payout_dispute_tolerance_cents: "1500" }).payoutDisputeToleranceCents, 1500);
  assert.match(read("app/api/app/accounting/settings/route.ts"), /payout_dispute_tolerance_cents: cents\.optional\(\),/);
});

test("a tax category override is one database call that writes its own audit row", () => {
  const store = read("lib/accounting/taxStore.ts");
  const fn = store.slice(store.indexOf("export async function setCategory"));
  assert.match(fn, /rpc\("set_tax_category_override"/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\n}\n")), /\.delete\(\)|\.insert\(/, "no delete-then-insert from the app");
});

test("P&L drill links open the carrier file's own page and the expense", () => {
  const store = read("lib/accounting/pnlStore.ts");
  assert.match(store, /href: `\/app\/carrier-files\/file\/\$\{r\.sourceFileId\}`/);
  assert.match(store, /href: `\/app\/expenses\?open=\$\{r\.expenseId\}`/);
  assert.match(read("app/api/app/accounting/pnl/drill/route.ts"), /const SECTIONS = \["in", "held",/);
});

test("a partner's claim is capped at what it disputes before it reaches the database", () => {
  const store = read("lib/accounting/payoutStore.ts");
  assert.match(store, /if \(input\.claimCents > ceiling\) throw new PayoutError/);
});
