// LA-7.6 (Notion sprint, Module 7 — Accounting) · bank import and deposit matching.
// Run with: node --experimental-strip-types --test lib/accounting/bank.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mappingProblem, parseBankCsv, suggestColumnMap } from "./bankCore.ts";
import { detect, DISCREPANCY_LABELS, DISCREPANCY_TYPES } from "../ingestion/discrepancyEngine.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015260000_la_7_6_bank_matching.sql";
const ACCT = "acct-1";

const CHASE = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #
CREDIT,10/21/2026,"ACH DEPOSIT  AETNA LIFE INS   COMM",3940.00,ACH_CREDIT,10000.00,
DEBIT,10/25/2026,DIALER CO SUBSCRIPTION,-449.00,ACH_DEBIT,9551.00,
CREDIT,10/24/2026,INTEREST,50.00,MISC,9601.00,
CREDIT,10/24/2026,INTEREST,50.00,MISC,9651.00,
CREDIT,13/45/2026,BROKEN DATE,1.00,MISC,0,
`;
const SPLIT = `Date,Memo,Withdrawals,Deposits,Ref
2026-10-09,AMERICO FIN LIFE PPD,,"1,300.00",A1
2026-10-12,E&O PREMIUM,(620.00),,A2
`;

test("the column mapping is guessed from the headers, checked, and remembered per account", () => {
  const chase = suggestColumnMap(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]);
  assert.deepEqual([chase.date, chase.description, chase.amount, chase.credit, chase.debit], ["Posting Date", "Description", "Amount", null, null]);
  const split = suggestColumnMap(["Date", "Memo", "Withdrawals", "Deposits", "Ref"]);
  assert.deepEqual([split.date, split.description, split.amount, split.credit, split.debit, split.reference], ["Date", "Memo", null, "Deposits", "Withdrawals", "Ref"]);
  assert.equal(suggestColumnMap(["Foo", "Bar"]), null);
  assert.match(mappingProblem({ date: "Posted", description: "Description", amount: "Amount" }, ["Date", "Description", "Amount"]), /no column called "Posted"/);
  // The mapping used is saved on the account at import.
  assert.match(read("lib/accounting/bankStore.ts"), /await saveAccount\(tenantId, by, \{ id: accountId, nickname: account\.nickname, bankName: account\.bankName, lastFour: account\.lastFour, columnMap: map \}\);/);
});

test("rows parse to signed cents with the bank's text verbatim; unreadable rows are reported, not guessed", () => {
  const p = parseBankCsv(CHASE, suggestColumnMap(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]), ACCT);
  assert.deepEqual(p.rows.map((r) => [r.posted_on, r.amount_cents]), [["2026-10-21", 394000], ["2026-10-25", -44900], ["2026-10-24", 5000], ["2026-10-24", 5000]]);
  assert.equal(p.rows[0].description_raw, "ACH DEPOSIT  AETNA LIFE INS   COMM", "double spaces kept");
  assert.deepEqual(p.skipped.map((s) => s.line), [6]);
  const s = parseBankCsv(SPLIT, suggestColumnMap(["Date", "Memo", "Withdrawals", "Deposits", "Ref"]), ACCT);
  assert.deepEqual(s.rows.map((r) => [r.amount_cents, r.reference]), [[130000, "A1"], [-62000, "A2"]], "money in positive, money out negative, parentheses read");
  const inverted = parseBankCsv(CHASE, { ...suggestColumnMap(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]), invert: true }, ACCT);
  assert.equal(inverted.rows[0].amount_cents, -394000);
});

test("identical lines stay distinct; re-importing an overlapping range hashes the same lines the same way", () => {
  const map = suggestColumnMap(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]);
  const a = parseBankCsv(CHASE, map, ACCT).rows;
  const interest = a.filter((r) => r.description_raw === "INTEREST");
  assert.equal(interest.length, 2);
  assert.notEqual(interest[0].content_hash, interest[1].content_hash, "two identical $50 lines on one day are two lines");
  const b = parseBankCsv(CHASE + "CREDIT,11/02/2026,NEW,1.00,MISC,0,\n", map, ACCT).rows;
  assert.deepEqual(b.slice(0, 4).map((r) => r.content_hash), a.map((r) => r.content_hash), "the overlap hashes identically");
  assert.notEqual(parseBankCsv(CHASE, map, "acct-2").rows[0].content_hash, a[0].content_hash, "the account is part of the hash");
  const sql = read(MIGRATION);
  assert.match(sql, /create unique index if not exists bank_transaction_dedupe on public\.bank_transaction \(bank_account_id, content_hash\);/);
  assert.match(sql, /on conflict \(bank_account_id, content_hash\) do nothing;/);
});

test("matching is many-to-many, suggested by the system and confirmed only by a person", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /carrier_account_statement_id uuid not null references public\.carrier_account_statement\(id\)/);
  assert.match(sql, /amount_applied_cents bigint not null,/);
  assert.match(sql, /create unique index if not exists deposit_match_pair on public\.deposit_match \(bank_transaction_id, carrier_account_statement_id\);/);
  const suggest = sql.slice(sql.indexOf("create or replace function public.suggest_deposit_matches"), sql.indexOf("create or replace function public.confirm_deposit_matches"));
  assert.doesNotMatch(suggest, /confirmed_by\s*,|confirmed_by =|confirmed_at/, "the system never confirms");
  assert.match(sql, /raise exception 'confirm_deposit_matches: a match is confirmed by a person'/);
  assert.match(sql, /constraint deposit_match_manual check \(confidence <> 'manual' or confirmed_by is not null\)/);
  assert.match(sql, /'That applies more than the deposit holds\.'/);
  assert.match(sql, /'That applies more than the statement says was paid\.'/);
  // Received in the P&L counts confirmed matches only.
  assert.match(read("supabase/migrations/20261015230000_la_7_7_pnl.sql"), /where d\.tenant_id = \$1 and d\.confirmed_by is not null/);
});

test("unexplained deposits and statements unpaid past their lag both surface; the second feeds LA-4.15", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create or replace function public\.deposit_unmatched_deposits/);
  assert.match(sql, /and exists \(select 1 from public\.bank_transaction t where t\.tenant_id = p_tenant_id and t\.posted_on >= s\.statement_date \+ s\.lag\)/, "only where bank data covers the date: else it is not imported, not missing");
  assert.match(sql, /select o\.expected_lag_days from public\.carrier_operating_settings o/, "the carrier's own lag (LA-4.17)");
  assert.match(sql, /'debit_balance_growing', 'not_received'\)\);/);
  assert.ok(DISCREPANCY_TYPES.includes("not_received"));
  assert.equal(DISCREPANCY_LABELS.not_received.label, "Paid but not received");
  const findings = detect({ today: "2026-12-05", policies: [], expected: [], entries: [], statements: [], carrierNames: new Map([["ahl", "AHL"]]), tolerance: () => 100,
    unreceived: [{ statementId: "s-1", carrierId: "ahl", statementDate: "2026-10-11", paidCents: 98000, receivedCents: 0, lagDays: 21, dueBy: "2026-11-01" }] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].discrepancy_type, "not_received");
  assert.equal(findings[0].difference_cents, 98000);
  assert.match(findings[0].explanation, /AHL's statement of Oct 11, 2026 says it paid \$980\.00\. No deposit has been matched to it, and it normally lands within 21 days \(by Nov 1, 2026\)\./);
  assert.deepEqual(detect({ today: "2026-12-05", policies: [], expected: [], entries: [], statements: [], carrierNames: new Map(), tolerance: () => 100 }), [], "LA-4's own callers are unchanged");
  // An account-level finding obeys LA-4.15's subject rule ("*" and no policy): one per carrier, its statements in the evidence.
  // (Found live on 2026-10-15: a statement id as the subject broke commission_discrepancy_subject.)
  const two = detect({ today: "2026-12-05", policies: [], expected: [], entries: [], statements: [], carrierNames: new Map([["ahl", "AHL"]]), tolerance: () => 100,
    unreceived: [{ statementId: "s-1", carrierId: "ahl", statementDate: "2026-10-11", paidCents: 98000, receivedCents: 0, lagDays: 21, dueBy: "2026-11-01" }, { statementId: "s-2", carrierId: "ahl", statementDate: "2026-09-11", paidCents: 2000, receivedCents: 500, lagDays: 21, dueBy: "2026-10-02" }] });
  assert.equal(two.length, 1);
  assert.equal(two[0].subject_key, "*");
  assert.equal(two[0].policy_number, null);
  assert.equal(two[0].difference_cents, 99500);
  assert.deepEqual(two[0].evidence.statements.map((s) => s.id), ["s-2", "s-1"]);
  assert.match(read("supabase/migrations/20261008250000_la_4_15_commission_discrepancies.sql"), /constraint commission_discrepancy_subject check \(\(subject_key = '\*'\) = \(policy_number is null\)\)/);
  assert.match(read("lib/ingestion/discrepancyStore.ts"), /db\(\)\.rpc\("deposit_unreceived_statements", \{ p_tenant_id: tenantId, p_today: today \}\)\.then\(\(r: Loose\) => \(r\.error \? \[\] : \(r\.data \?\? \[\]\)\) as Loose\[\]\)/);
});

test("a bank line is kept as the bank wrote it; nothing writes the commission ledger", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /if \(to_jsonb\(new\) - 'match_status' - 'ignored_reason'\) <> \(to_jsonb\(old\) - 'match_status' - 'ignored_reason'\) then/);
  assert.match(sql, /raise exception 'A bank line is never removed; mark it ignored with a reason\.'/);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.commission_entry/);
  for (const f of ["app/api/app/accounting/bank/route.ts", "app/api/app/accounting/bank/import/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "bookkeeper"], f);
  }
});
