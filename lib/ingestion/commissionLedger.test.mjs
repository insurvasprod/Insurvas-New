// LA-4.12 (Notion sprint) · the commission ledger: signs, rollup, unearned advance, immutability, no floats.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { centsText, ENTRY_TYPES, isAccountLevel, normalizeAccountLine, normalizeLine, rollup, unearnedAdvance } from "./commissionLedger.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008220000_la_4_12_commission_ledger.sql");
const line = (values, rowNumber = 1) => normalizeLine({ rowNumber, values: { policy_number: "P1", ...values } });

test("all eight entry types store with the right sign, whatever sign the carrier used", () => {
  assert.equal(ENTRY_TYPES.length, 8);
  const cases = [
    ["advance", 55295, "advance", 55295], ["earned", 1200, "earned", 1200], ["override", 4000, "override", 4000], ["held", 350, "held", 350],
    ["chargeback", 43006, "chargeback", -43006], ["chargeback", -43006, "chargeback", -43006],
    ["fee", 500, "fee", -500], ["advance_interest", 120, "advance_interest", -120],
    ["reversal", -700, "reversal", -700], ["reversal", 700, "reversal", 700],
  ];
  for (const [type, amount, wantType, wantAmount] of cases) {
    const outcome = line({ entry_type: type, amount_cents: amount });
    assert.ok(outcome.ok, `${type} ${amount}`);
    assert.deepEqual([outcome.line.entry_type, outcome.line.amount_cents], [wantType, wantAmount], `${type} ${amount}`);
  }
  // A negative advance is the carrier taking it back: a reversal OF an advance, so totals stay right.
  const back = line({ entry_type: "advance", amount_cents: -55295 });
  assert.deepEqual([back.line.entry_type, back.line.corrects_type, back.line.amount_cents], ["reversal", "advance", -55295]);
});

test("a line the ledger can't classify, or with a fraction of a cent, is refused, never rounded", () => {
  assert.equal(line({ entry_type: null, amount_cents: 100 }).ok, false);
  assert.equal(line({ entry_type: "bonus", amount_cents: 100 }).ok, false);
  assert.equal(line({ entry_type: "earned", amount_cents: null }).ok, false);
  assert.match(line({ entry_type: "earned", amount_cents: 100.5 }).reason, /whole cents/);
  assert.match(line({ entry_type: "earned", amount_cents: 100, rate_bp: 14.5 }).reason, /rate_bp/);
  assert.equal(normalizeLine({ rowNumber: 3, values: { policy_number: " ", entry_type: "earned", amount_cents: 1 } }).reason, "no policy number");
});

test("SUM over a policy equals the statement's net; held is apart; a reprocess does not double an advance", () => {
  // The rehearsal's statement: advance 552.95, override 40.00, chargeback −430.06, held 3.50, fee −5.00.
  const statement = [
    { entry_type: "advance", corrects_type: null, amount_cents: 55295 },
    { entry_type: "override", corrects_type: null, amount_cents: 4000 },
    { entry_type: "chargeback", corrects_type: null, amount_cents: -43006 },
    { entry_type: "held", corrects_type: null, amount_cents: 350 },
    { entry_type: "fee", corrects_type: null, amount_cents: -500 },
  ];
  const once = rollup(statement);
  assert.equal(once.netReceivedCents, 55295 + 4000 - 43006 - 500);
  assert.equal(once.heldCents, 350);
  // The advance line read again with a new amount: reversal of the old, the new line.
  const again = rollup([...statement, { entry_type: "reversal", corrects_type: "advance", amount_cents: -55295 }, { entry_type: "advance", corrects_type: null, amount_cents: 60000 }]);
  assert.equal(again.advancedCents, 60000);
  assert.equal(again.netReceivedCents, 60000 + 4000 - 43006 - 500);
  // Bigints from Postgres arrive as strings: still exact.
  assert.equal(rollup([{ entry_type: "earned", corrects_type: null, amount_cents: "9007199254740" }]).earnedCents, 9007199254740);
  assert.throws(() => rollup([{ entry_type: "earned", corrects_type: null, amount_cents: 1.5 }]), /whole cents/);
});

test("unearned advance: 9ths by months paid, traced, Unknown without its inputs, and less what's already taken back", () => {
  const prorated = unearnedAdvance({ advancedCents: 55295, chargedBackCents: 0, monthsPaid: 2, rule: null, statementMonths: 9 });
  assert.deepEqual([prorated.unearnedCents, prorated.atRiskCents, prorated.months, prorated.monthsSource], [43007, 43007, 9, "statement"]);
  const after = unearnedAdvance({ advancedCents: 55295, chargedBackCents: -43006, monthsPaid: 2, rule: null, statementMonths: 9 });
  assert.equal(after.atRiskCents, 1, "what the carrier took back is no longer at risk");
  const rule = unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: 2, rule: { advanceMonths: 9, clawbackMonths: 9, clawbackType: "prorated" }, statementMonths: 12 });
  assert.deepEqual([rule.unearnedCents, rule.monthsSource], [50750, "advance rule"], "$652.50 advance, 2 of 9 paid → $507.50 (the spec's example)");
  const full = unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: 5, rule: { advanceMonths: 9, clawbackMonths: 6, clawbackType: "full" }, statementMonths: null });
  assert.equal(full.unearnedCents, 65250);
  assert.equal(unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: 6, rule: { advanceMonths: 9, clawbackMonths: 6, clawbackType: "full" }, statementMonths: null }).unearnedCents, 0);
  assert.equal(unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: 12, rule: null, statementMonths: 9 }).unearnedCents, 0, "nothing after month 9");
  const unknown = unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: 2, rule: null, statementMonths: null });
  assert.equal(unknown.unearnedCents, null);
  assert.match(unknown.reason, /no advance rule/);
  assert.equal(unearnedAdvance({ advancedCents: 65250, chargedBackCents: 0, monthsPaid: null, rule: null, statementMonths: 9 }).unearnedCents, null);
  for (const trace of [prorated, after, rule, full]) assert.ok(Number.isSafeInteger(trace.unearnedCents) && Number.isSafeInteger(trace.atRiskCents));
});

test("no float in the ingestion, storage or rollup path", () => {
  for (const file of ["lib/ingestion/commissionLedger.ts", "lib/ingestion/commissionLedgerStore.ts"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(source, /parseFloat|toFixed|Math\.round|\/ 100\b|\* 0\.\d|\bnumeric\b/, file);
  }
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(numeric|real|double precision|float)\b/i, "the migration stores integers only");
  assert.match(sql, /amount_cents bigint not null/);
});

test("entries are never updated or deleted: grants revoked, trigger, one writer; every entry is traceable", () => {
  assert.match(sql, /revoke insert, update, delete, truncate on public\.commission_entry from service_role, tenant_app/);
  assert.match(sql, /before update or delete on public\.commission_entry/);
  assert.match(sql, /has_table_privilege\('service_role', 'public\.commission_entry', 'UPDATE'\)/);
  assert.match(sql, /file_id uuid not null,\s*raw_row_id uuid not null/);
  assert.match(sql, /foreign key \(file_id, raw_row_id\) references public\.raw_rows \(file_id, id\)/);
  const store = read("lib/ingestion/commissionLedgerStore.ts");
  assert.doesNotMatch(store, /from\("commission_entry"\)\.(insert|update|upsert|delete)/);
  assert.match(store, /rpc\("record_commission_entries"/);
});

test("an override and a writing-agent advance on one policy coexist: the fingerprint keeps the row and the type", () => {
  assert.match(sql, /e\.row_number = i\.row_number and e\.fingerprint = i\.fingerprint/);
  assert.match(sql, /md5\(row\(btrim\(r\.policy_number\), r\.entry_type,/);
  const both = rollup([{ entry_type: "advance", corrects_type: null, amount_cents: 55295 }, { entry_type: "override", corrects_type: null, amount_cents: 4000 }]);
  assert.deepEqual([both.advancedCents, both.overrideCents], [55295, 4000]);
});

test("cents print by integer division, never through a float", () => {
  assert.deepEqual([centsText(-43006), centsText(5), centsText(0), centsText(100000001)], ["-430.06", "0.05", "0.00", "1000000.01"]);
  assert.throws(() => centsText(0.1 + 0.2));
  assert.doesNotMatch(read("components/app/carrier-ledger.tsx"), /toFixed/);
});

test("a line that names no policy is an account line: same type and sign rules, its description kept", () => {
  const row = { rowNumber: 4, values: { policy_number: null, entry_type: "advance_interest", amount_cents: 4625, description: "  Advance interest, September  ", statement_date: "2026-09-01" } };
  assert.equal(isAccountLevel(row), true);
  assert.equal(isAccountLevel({ values: { policy_number: " 0904585 " } }), false);
  const outcome = normalizeAccountLine(row);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.line, { row_number: 4, entry_type: "advance_interest", corrects_type: null, amount_cents: -4625, transaction_date: null, statement_date: "2026-09-01", agent_identifier: null, description: "Advance interest, September" });
  assert.equal(normalizeAccountLine({ rowNumber: 5, values: { policy_number: "", entry_type: "advance_interest", amount_cents: null } }).ok, false, "an account line still needs an amount");
});

test("account lines go to their own writer on every reading, and count toward the statement check", () => {
  const store = readFileSync(new URL("./commissionLedgerStore.ts", import.meta.url), "utf8");
  assert.match(store, /typedRows\.filter\(\(row\) => !isAccountLevel\(row\)\)\.map\(normalizeLine\)/);
  assert.match(store, /rpc\("record_account_entries", \{ p_tenant_id: tenantId, p_file_id: fileId, p_rows: accountRows \}\)/);
  const sql = readFileSync(new URL("../../supabase/migrations/20261009130000_la_4_account_level_commission.sql", import.meta.url), "utf8");
  assert.match(sql, /trigger commission_account_entry_guard before update or delete/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.commission_account_entry from service_role, tenant_app;/);
  assert.match(sql, /select ae\.amount_cents, ae\.entry_type, ae\.corrects_type from public\.commission_account_entry ae/);
});