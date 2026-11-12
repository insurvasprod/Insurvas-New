// LA-7.7 (Notion sprint, Module 7 — Accounting) · the P&L.
// Run with: node --experimental-strip-types --test lib/accounting/pnl.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  changeOf, changeTone, chargebackTax, comparisons, costLineOf, customRange, divideCents, inBankFor, inBankTotal, lastYearLabel, lineKey, mergeStatement,
  moneyIn, namedRange, paidByLine, periodRange, periodWords, perPolicy, persisting, readableDate, resolvePeriod, statement, statementOrder,
} from "./pnlCore.ts";
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
  assert.match(read("components/app/accounting/pnl-board.tsx"), /received\.imported \? money\(received\.cents\) : <Link className=\{AMOUNT\} href=\{BANK_ACCOUNTS_HREF\}>Not imported<\/Link>/);
  assert.match(read(MIGRATION), /if not v_any then\n\s+return null;/);
});

test("the basis is stated on screen and switching it changes which date counts", () => {
  const board = read("components/app/accounting/pnl-board.tsx");
  assert.match(read("app/app/(shell)/pnl/page.tsx"), /\$\{BASIS_NOTE\[loaded\.data\.basis\]\}/, "the title's (i) names the basis");
  assert.match(board, /<Segmented label="Basis"/);
  assert.match(read("lib/accounting/pnlStore.ts"), /const s = fromRow\(data\);\n\s+return \{ basis: s\.defaultBasis,/, "the agency's basis (accrual unless it chose cash)");
});

test("every line opens its entries, and each entry links to its source", () => {
  const board = read("components/app/accounting/pnl-board.tsx");
  assert.match(board, /<Link className="[^"]*" href=\{entriesHref\(l, query\)\}>\{lineLabel\(l\)\}<\/Link>/, "a line opens its entries page");
  assert.doesNotMatch(board, /<Sheet\b/, "never a side sheet (foundation pass 2026-11-03)");
  assert.match(read("app/app/(shell)/pnl/entries/page.tsx"), /result = await drill\(tenantId, \{ range: period\.range, basis: period\.basis, section, entryType, sourceType, sourceId,/);
  const store = read("lib/accounting/pnlStore.ts");
  // Round 7 (5·2): an entry opens its source's own page — a bill page, an expense page, a payout run, a commission statement.
  for (const src of ["/app/vendor-bills/${r.invoiceId}", "/app/expenses/${r.expenseId}", "/app/payouts/${r.payoutRunId}", "/app/carrier-files/file/"]) assert.ok(store.includes(src), src);
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
  // Round 7: dates readable on screen.
  assert.deepEqual(customRange("2026-08-15", "2026-08-31"), { from: "2026-08-15", to: "2026-09-01", label: "Aug 15, 2026 to Aug 31, 2026" });
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

// ─── Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html 5·A–5·3): a full statement ───────────────

const LEADS = (amount, extra = {}) => L("acquisition", "lead_cost", amount, { sourceType: "vendor", sourceId: "v1", sourceName: "Crestview Lists", ...extra });
const OFFICE = (amount) => L("overhead", "other", amount, { sourceType: "expense_category", sourceName: "office" });

test("every line is filled across the periods: lines are merged on their identity, a missing side is null", () => {
  const cur = [L("in", "advance", 1842000), L("in", "chargeback", -214050), LEADS(-494000), OFFICE(-120000), L("overhead", "other", -50000, { sourceType: "expense_category", sourceName: "licensing" })];
  const prev = [L("in", "advance", 1698000), L("in", "chargeback", -241220), LEADS(-421000), OFFICE(-120000), L("in", "reversal", -35500)];
  const ly = [L("in", "advance", 1120000), LEADS(-310000)];
  const rows = mergeStatement(cur, prev, ly);
  assert.deepEqual(rows.in.map((r) => [r.line.entryType, r.cur, r.prev, r.lastYear]), [["advance", 1842000, 1698000, 1120000], ["chargeback", -214050, -241220, null], ["reversal", null, -35500, null]], "a line only in the period before is still on the statement, after this period's, in the statement's order");
  assert.deepEqual(rows.acquisition.map((r) => [r.cur, r.prev, r.lastYear]), [[-494000, -421000, -310000]]);
  const licensing = rows.overhead.find((r) => r.line.sourceName === "licensing");
  assert.deepEqual([licensing.cur, licensing.prev, licensing.lastYear], [-50000, null, null]);
  assert.notEqual(lineKey(OFFICE(0)), lineKey({ ...OFFICE(0), sourceName: "licensing" }), "an expense line is its category");
  assert.deepEqual(statementOrder(rows).map((r) => r.line.section), ["in", "in", "in", "acquisition", "overhead", "overhead"], "‹ › walk the statement top to bottom");
  // Held money stays its own section in the merge, whatever section an old reader filed it under.
  const held = mergeStatement([L("in", "held", 5000)], [], []);
  assert.equal(held.in.length, 0);
  assert.equal(held.held[0].line.section, "held");
});

test("the change: this period less the period before; up is green and down is red on every line, a cost per policy the other way", () => {
  assert.equal(changeOf(1842000, 1698000), 144000);
  assert.equal(changeTone(changeOf(1842000, 1698000)), "good", "income that grew");
  assert.equal(changeTone(changeOf(-494000, -421000)), "bad", "a cost that grew (−$730.00) is red");
  assert.equal(changeTone(changeOf(-214050, -241220)), "good", "fewer chargebacks (+$271.70) is green");
  assert.equal(changeOf(-50000, null), -50000, "a new cost is all change");
  assert.equal(changeOf(null, null), null);
  assert.equal(changeTone(0), "none");
  assert.equal(changeTone(changeOf(14291, 12930), true), "bad", "a dearer policy (+$13.61) is red");
});

test("in the bank per line: a cost on cash is itself, on accrual its paid entries; money in is never a share, and never $0 without a bank file", () => {
  const leads = { key: lineKey(LEADS(0)), line: { ...LEADS(-494000), entries: 3 }, cur: -494000 };
  const paid = paidByLine([
    { entryType: "lead_cost", amountCents: -93000, vendorId: "v1", partnerId: null, expenseId: null, expenseCategory: null, expenseAcquisition: null },
    { entryType: "lead_cost", amountCents: -118000, vendorId: "v1", partnerId: null, expenseId: null, expenseCategory: null, expenseAcquisition: null },
  ]);
  assert.deepEqual(inBankFor(leads, "accrual", { imported: true, cents: 1 }, paid), { kind: "cents", cents: -211000, paid: 2, of: 3 }, "2 of 3 paid");
  assert.deepEqual(inBankFor(leads, "cash", { imported: false }, null), { kind: "cents", cents: -494000, paid: 3, of: 3 }, "cash counts the day it was paid");
  assert.deepEqual(inBankFor(leads, "accrual", { imported: true, cents: 1 }, null), { kind: "gap" }, "no paid read: —, never a guess");
  assert.deepEqual(inBankFor({ ...leads, key: lineKey(OFFICE(0)), line: OFFICE(-120000) }, "accrual", { imported: true, cents: 1 }, paid), { kind: "cents", cents: 0, paid: 0, of: 1 }, "nothing paid yet is a true $0.00");
  const advance = { key: "x", line: L("in", "advance", 1842000), cur: 1842000 };
  assert.deepEqual(inBankFor(advance, "accrual", { imported: false }, paid), { kind: "not_imported" });
  assert.deepEqual(inBankFor(advance, "accrual", { imported: true, cents: 1240411 }, paid), { kind: "gap" }, "the bank matches statements, not entry types");
  assert.deepEqual(inBankFor({ ...leads, cur: null }, "cash", { imported: true, cents: 1 }, paid), { kind: "gap" }, "a line not in this period has nothing in the bank this period");
  const rows = [{ ...leads, bank: { kind: "cents", cents: -211000, paid: 2, of: 3 } }, { ...leads, bank: { kind: "cents", cents: -100, paid: 1, of: 1 } }];
  assert.equal(inBankTotal(rows), -211100);
  assert.equal(inBankTotal([...rows, { ...leads, bank: { kind: "gap" } }]), null, "a total is only as known as its lines");
});

test("a paid cost lands on the line pnl_lines puts it on", () => {
  const c = (extra) => ({ entryType: "lead_cost", amountCents: -1, vendorId: null, partnerId: null, expenseId: null, expenseCategory: null, expenseAcquisition: null, ...extra });
  assert.deepEqual(costLineOf(c({ partnerId: "p1", vendorId: "v1" })), { section: "acquisition", entryType: "lead_cost", sourceType: "partner", sourceId: "p1", sourceName: null }, "a partner invoice lists under the partner");
  assert.deepEqual(costLineOf(c({ vendorId: "v1" })), { section: "acquisition", entryType: "lead_cost", sourceType: "vendor", sourceId: "v1", sourceName: null });
  assert.equal(costLineOf(c({ entryType: "producer_split" })).section, "splits");
  assert.deepEqual(costLineOf(c({ entryType: "other", expenseId: "x1", expenseCategory: "office", expenseAcquisition: false })), { section: "overhead", entryType: "other", sourceType: "expense_category", sourceId: null, sourceName: "office" });
  assert.equal(costLineOf(c({ entryType: "tool_subscription", expenseId: "x1", expenseCategory: "software", expenseAcquisition: true })).section, "acquisition");
  assert.equal(costLineOf(c({ entryType: "refund" })).section, "overhead", "a refund with no vendor or partner is overhead");
  assert.equal(costLineOf(c({ entryType: "platform_fee", vendorId: "v1" })).sourceType, null, "only lead costs, payouts and refunds name their source");
  // The same cases as the database's one definition.
  const sql = read(MIGRATION);
  assert.match(sql, /when p_entry_type = 'producer_split' then 'splits'\n\s+when p_expense_id is not null then case when p_expense_acquisition then 'acquisition' else 'overhead' end/);
});

test("the columns name their periods; comparison periods are named, never 'Previous period'", () => {
  assert.deepEqual(periodWords("month"), { current: "This month", previous: "Month before", before: "the month before" });
  assert.equal(periodWords("custom").previous, "Period before");
  assert.equal(lastYearLabel("month", comparisons("month", periodRange("month", "2026-11-01")).lastYear), "Nov 2025");
  assert.equal(lastYearLabel("quarter", comparisons("quarter", periodRange("quarter", "2026-11-01")).lastYear), "Q4 2025");
  assert.equal(namedRange("month", comparisons("month", periodRange("month", "2026-11-01")).previous), "October 2026");
  assert.equal(namedRange("custom", comparisons("custom", customRange("2026-08-15", "2026-08-31")).previous), "Jul 29, 2026 to Aug 14, 2026");
  assert.equal(readableDate("2027-12-30"), "Dec 30, 2027");
});

test("the page as drawn: four tiles, controls only where they apply, the (i) two sentences, no 1099 card, the entries page names its line", () => {
  const board = read("components/app/accounting/pnl-board.tsx");
  const page = read("app/app/(shell)/pnl/page.tsx");
  const entries = read("app/app/(shell)/pnl/entries/page.tsx");
  assert.equal((board.match(/<StatTile /g) ?? []).length, 4, "Net profit · Commission reported · Acquisition cost · Cost per issued policy");
  assert.doesNotMatch(board, /Cost per persisting policy \(/, "the persisting tile lives on its tab");
  assert.doesNotMatch(board + page, /Callout|taxMissing|contractors\(/, "Tax owns the 1099 count");
  assert.match(page, /const info = loaded \? `\$\{BASIS_NOTE\[loaded\.data\.basis\]\} \$\{ACQUISITION_CONSEQUENCE\}` : undefined;/);
  assert.match(board, /if \(view === "cohorts"\) \{\n\s+return \(\n\s+<div ref=\{box\} className="flex min-h-0 flex-col">\n\s+<CohortCard/, "no toolbar on Persisting cost");
  assert.match(board, /toolbar=\{<DataToolbar actions=\{basis\} \/>\}/, "Basis only on Last six months");
  assert.doesNotMatch(entries, /facts=|q\.label|label\?: string/, "the title is never taken from the address, and stands alone");
  assert.match(entries, /<RecordStepper noun="line"/);
  assert.match(entries, /title="This line is not on the statement\."/);
  assert.doesNotMatch(read("lib/accounting/pnlLinks.ts"), /p\.set\("label"/);
});
