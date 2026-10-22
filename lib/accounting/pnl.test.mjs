// LA-7.7 (Notion sprint, Module 7 — Accounting) · the P&L.
// Run with: node --experimental-strip-types --test lib/accounting/pnl.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chargebackTax, comparisons, customRange, divideCents, moneyIn, periodRange, perPolicy, persisting, resolvePeriod, statement } from "./pnlCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015230000_la_7_7_pnl.sql";
const L = (section, entryType, amountCents, extra = {}) => ({ section, entryType, sourceType: null, sourceId: null, sourceName: null, amountCents, entries: 1, ...extra });

// The module doc's August: $18,420 advances, $4,110 earned, −$4,120 chargebacks; $11,294 acquisition; $620 overhead.
const AUGUST = [
  L("in", "chargeback", -412000), L("in", "advance", 1842000), L("in", "earned", 411000),
  L("acquisition", "lead_cost", -620500, { sourceType: "partner", sourceName: "Apex Call Center" }),
  L("acquisition", "lead_cost", -289000, { sourceType: "partner", sourceName: "Vertex Media" }),
  L("acquisition", "lead_cost", -175000, { sourceType: "vendor", sourceName: "DataLeads Inc" }),
  L("acquisition", "tool_subscription", -44900, { sourceType: "expense_category", sourceName: "telephony" }),
  L("overhead", "insurance", -62000, { sourceType: "expense_category", sourceName: "insurance" }),
];

test("money in, acquisition, overhead and net profit add up exactly", () => {
  const s = statement(AUGUST);
  assert.equal(s.inCents, 1841000);
  assert.equal(s.acquisitionCents, -1129400);
  assert.equal(s.overheadCents, -62000);
  assert.equal(s.netProfitCents, 1841000 - 1129400 - 62000);
  assert.deepEqual(s.in.map((l) => l.entryType), ["advance", "earned", "chargeback"], "advances first, chargebacks after");
  // The database side reconciles each section to the money view (rehearsed on data); its dates are the view's own.
  const sql = read(MIGRATION);
  const view = read("supabase/migrations/20261015200000_la_7_1_cost_ledger.sql");
  assert.match(view, /coalesce\(e\.transaction_date, e\.statement_date\) as incurred_on,\n\s+e\.statement_date as paid_on,/);
  assert.match(sql, /v_comm := case when p_basis = 'cash' then 'e\.statement_date' else 'coalesce\(e\.transaction_date, e\.statement_date\)' end;/);
  assert.match(sql, /v_cost := case when p_basis = 'cash' then 'c\.paid_on' else 'c\.incurred_on' end;/);
});

test("only acquisition divides into cost per policy — a worked example with an overhead expense", () => {
  const s = statement(AUGUST);
  const p = perPolicy(s.acquisitionCents, 18, 10);
  assert.deepEqual(p, { kind: "rate", cents: 62744, policies: 18 }, "$11,294 ÷ 18 = $627.44; the $620 E&O premium is not in it");
  assert.equal(divideCents(1129400 + 62000, 18), 66189, "what it would have been had overhead been divided in");
  assert.match(read("lib/accounting/pnlStore.ts"), /const perIssued = perPolicy\(s\.acquisitionCents, cohort\.length, settings\.threshold\);/);
  assert.match(read("lib/accounting/pnlStore.ts"), /acquisitionCents: s\.acquisitionCents, issued: cell\.eligible, alive: cell\.alive/);
});

test("under the sample threshold: counts, not a rate", () => {
  assert.deepEqual(perPolicy(-1129400, 7, 10), { kind: "counts", spendCents: 1129400, policies: 7 });
  assert.deepEqual(perPolicy(-1129400, 0, 10), { kind: "none" });
  assert.equal(perPolicy(-1129400, 10, 10).kind, "rate");
});

test("the persisting figure inside its horizon is building, with months elapsed — never a partial figure", () => {
  const aug = periodRange("month", "2026-08-01");
  const b = persisting({ range: aug, horizon: 9, today: "2026-10-15", acquisitionCents: -1129400, issued: 18, alive: 17, cohortBuilding: false, threshold: 10 });
  assert.deepEqual(b, { kind: "building", horizon: 9, monthsElapsed: 2, readyOn: "2027-05-31" });
  const ready = persisting({ range: aug, horizon: 9, today: "2027-06-01", acquisitionCents: -1129400, issued: 18, alive: 12, cohortBuilding: false, threshold: 10 });
  assert.deepEqual(ready, { kind: "figure", horizon: 9, issued: 18, alive: 12, perPolicy: { kind: "rate", cents: 94117, policies: 12 } });
  assert.equal(chargebackTax(perPolicy(-1129400, 18, 10), ready), 94117 - 62744, "the chargeback tax is the gap");
  assert.equal(persisting({ range: aug, horizon: 9, today: "2027-06-01", acquisitionCents: -1, issued: 1, alive: 1, cohortBuilding: true, threshold: 10 }).kind, "building", "LA-4.18 saying the book is too young also means building");
  // Persistency is LA-4.18's, not a second definition.
  const store = read("lib/accounting/pnlStore.ts");
  assert.match(store, /import \{ historyStart, issued, persistency, type Bucket, type ScorePolicy \} from "@\/lib\/ingestion\/scorecards";/);
  assert.match(store, /const cell = persistency\(cohort, settings\.horizon, book\.today, historyStart\(book\.rows\)\);/);
});

test("reported and received are separate columns and never summed; no bank data reads 'not imported', not zero", () => {
  assert.deepEqual(moneyIn(1841000, null), { reportedCents: 1841000, received: { imported: false } });
  assert.deepEqual(moneyIn(1841000, 1819000), { reportedCents: 1841000, received: { imported: true, cents: 1819000 } });
  assert.deepEqual(moneyIn(1841000, 0).received, { imported: true, cents: 0 }, "a true zero stays a zero");
  for (const f of ["lib/accounting/pnlStore.ts", "components/app/accounting/pnl-board.tsx", "lib/accounting/pnlCore.ts"]) {
    for (const line of read(f).split("\n")) {
      assert.doesNotMatch(line, /(reportedCents|inCents)\s*[+-]\s*[\w.]*received|received[\w.]*\s*[+-]\s*[\w.]*(reportedCents|inCents)/, `${f}: ${line.trim()}`);
    }
  }
  assert.match(read("components/app/accounting/pnl-board.tsx"), /received\.imported \? money\(received\.cents\) : <span className="text-muted-foreground">Not imported<\/span>/);
  assert.match(read(MIGRATION), /if not v_any then\n\s+return null;/);
});

test("the basis is stated on screen and switching it changes which date counts", () => {
  const board = read("components/app/accounting/pnl-board.tsx");
  assert.match(board, /\{BASIS_NOTE\[data\.basis\]\}/);
  assert.match(board, /<Segmented label="Basis"/);
  assert.match(read("lib/accounting/pnlStore.ts"), /const s = fromRow\(data\);\n\s+return \{ basis: s\.defaultBasis,/, "the agency's basis (accrual unless it chose cash)");
});

test("every line opens its entries, and each entry links to its source", () => {
  const board = read("components/app/accounting/pnl-board.tsx");
  assert.match(board, /onClick=\{\(\) => setOpen\(l\)\}/);
  const store = read("lib/accounting/pnlStore.ts");
  for (const src of ["/app/invoices?open=", "/app/expenses?open=", "/app/payouts?open=", "/app/carrier-files/file/"]) assert.ok(store.includes(src), src);
  assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === "app/api/app/accounting/pnl/drill/route.ts")?.allowedRoles, ["owner", "bookkeeper"]);
});

test("periods: month, quarter and year on the agency's financial year, with the period before and last year", () => {
  assert.deepEqual(periodRange("month", "2026-08-17"), { from: "2026-08-01", to: "2026-09-01", label: "August 2026" });
  assert.deepEqual(periodRange("quarter", "2026-08-17"), { from: "2026-07-01", to: "2026-10-01", label: "Q3 2026" });
  assert.deepEqual(periodRange("year", "2026-08-17"), { from: "2026-01-01", to: "2027-01-01", label: "2026" });
  assert.equal(periodRange("year", "2026-02-10", 4).from, "2025-04-01", "a financial year from April");
  assert.equal(periodRange("quarter", "2026-05-10", 4).from, "2026-04-01");
  assert.deepEqual(comparisons("month", periodRange("month", "2026-01-05")).previous, { from: "2025-12-01", to: "2026-01-01", label: "Previous period" });
  assert.equal(comparisons("quarter", periodRange("quarter", "2026-08-01")).lastYear.from, "2025-07-01");
  assert.deepEqual(customRange("2026-08-15", "2026-08-31"), { from: "2026-08-15", to: "2026-09-01", label: "2026-08-15 to 2026-08-31" });
  assert.equal(customRange("2026-09-01", "2026-08-31"), null);
  assert.deepEqual(comparisons("custom", customRange("2026-08-15", "2026-08-31")).previous, { from: "2026-07-29", to: "2026-08-15", label: "Previous period" });
  assert.deepEqual(resolvePeriod({ kind: "month", anchor: "2026-08" }, { basis: "accrual", fyStartMonth: 1, today: "2026-10-15" }), { kind: "month", range: periodRange("month", "2026-08-01"), basis: "accrual" });
  assert.ok("error" in resolvePeriod({ kind: "custom", from: "x" }, { basis: "accrual", fyStartMonth: 1, today: "2026-10-15" }));
});

test("the horizon is one of LA-4.18's persistency months, and every reporting setting is the agency's", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /persistency_month in \(3, 6, 9, 13\)/);
  assert.match(sql, /add column if not exists persistency_month integer not null default 9/);
  assert.match(sql, /add column if not exists sample_threshold integer not null default 10/);
  assert.match(read("app/app/(shell)/pnl/page.tsx"), /if \(!actAsPage\(guard, \["owner", "bookkeeper"\]\)\)/);
});
