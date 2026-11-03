// LA-4.14 (Notion sprint) · orphans and carrier account statements.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accountTrend, statementProblem } from "./carrierAccounts.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261008240000_la_4_14_orphans_and_accounts.sql", import.meta.url), "utf8");
const st = (date, opening, activity, closing, extra = {}) => ({ id: date, carrierId: "c", statementDate: date, fileId: null, openingCents: opening, activityCents: activity, closingCents: closing, debitCents: Math.min(0, closing), amountPaidCents: null, heldCents: null, minimumPayoutCents: null, entriesCents: null, entries: null, arithmeticOk: opening + activity === closing, entriesOk: true, continuityOk: true, previousStatementDate: null, ...extra });

test("the direction of the balance: a debit that grows is flagged, and how long it has fallen", () => {
  const t = accountTrend([st("2026-09-04", 0, -10000, -10000), st("2026-08-28", 5000, -5000, 0), st("2026-09-11", -10000, -2000, -12000)]);
  assert.deepEqual(t.rows.map((r) => [r.statementDate, r.changeCents, r.trend]), [["2026-08-28", null, "first"], ["2026-09-04", -10000, "worsening"], ["2026-09-11", -2000, "worsening"]]);
  assert.equal(t.growingDebit, true);
  assert.equal(t.fallingFor, 2);
  const clearing = accountTrend([st("2026-09-04", 0, -10000, -10000), st("2026-09-11", -10000, 4000, -6000)]);
  assert.deepEqual([clearing.growingDebit, clearing.latest.trend], [false, "improving"], "a debit being worked off is not an alarm");
});

test("a statement that doesn't add up says why, in the statement's own numbers", () => {
  assert.equal(statementProblem(st("2026-07-31", -10000, 87195, 70000)), "Opening −$100.00 plus activity $871.95 is $771.95, not the closing $700.00.");
  assert.equal(statementProblem({ ...st("2026-07-31", 0, 5000, 5000), entriesOk: false, entriesCents: 4500 }), "Its lines add up to $45.00, not the stated activity of $50.00.");
  assert.equal(statementProblem(st("2026-07-31", 0, 5000, 5000)), null);
  assert.equal(accountTrend([st("a", 0, 1, 2), st("b", 5, 0, 5, { continuityOk: false })]).gaps, 1);
});

test("the migration: orphans are found by carrier and number, never written; flagged statements hold their lines", () => {
  assert.match(sql, /not exists \(select 1 from public\.policy_current pc where pc\.tenant_id = e\.tenant_id and pc\.carrier_id = e\.carrier_id and pc\.policy_number = e\.policy_number\)/);
  assert.doesNotMatch(sql, /update public\.commission_entry/i, "orphans are never claimed by writing to the ledger");
  assert.match(sql, /'orphan_commission'\), 60\)/, "default threshold 60 days");
  assert.match(sql, /resolve_queue_item\(r\.tenant_id, r\.id, null, 'resolved', 'auto_linked'/, "an orphan's item closes itself when the policy arrives");
  assert.match(sql, /\(s\.opening_balance_cents \+ s\.activity_cents = s\.closing_balance_cents\) as arithmetic_ok/);
  assert.match(sql, /lag\(s\.closing_balance_cents\) over w = s\.opening_balance_cents\) as continuity_ok/);
  assert.match(sql, /debit_balance_cents bigint generated always as \(case when closing_balance_cents < 0 then closing_balance_cents else 0 end\) stored/);
  assert.match(sql, /where not exists \(select 1 from public\.carrier_account_checks c where c\.tenant_id = e\.tenant_id and c\.file_id = e\.file_id and c\.flagged\)/);
  assert.match(sql, /coalesce\(ce\.corrects_type, ce\.entry_type\) <> 'held'/, "held is reported apart, not as activity");
});
