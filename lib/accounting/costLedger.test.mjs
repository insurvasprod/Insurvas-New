// LA-7.1 (Notion sprint, Module 7 — Accounting) · the cost ledger and the unified money view.
// Run with: node --experimental-strip-types --test lib/accounting/costLedger.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COST_ENTRY_TYPES, monthPeriod, signedForType, signProblem, totals } from "./costLedgerCore.ts";
import { la7Files } from "./la7Files.mjs";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015200000_la_7_1_cost_ledger.sql";

test("all nine cost entry types exist in the code and in the database", () => {
  assert.deepEqual([...COST_ENTRY_TYPES], ["lead_cost", "partner_payout", "producer_split", "platform_fee", "tool_subscription", "insurance", "professional_fee", "refund", "adjustment"]);
  assert.match(read(MIGRATION), new RegExp(`entry_type in \\(${COST_ENTRY_TYPES.map((t) => `'${t}'`).join(", ")}\\)`));
});

test("money out is negative; a refund is money back; an adjustment goes either way", () => {
  assert.equal(signProblem("lead_cost", -175000), null);
  assert.match(signProblem("lead_cost", 175000), /negative/);
  assert.equal(signProblem("refund", 500), null);
  assert.match(signProblem("refund", -500), /positive/);
  assert.equal(signProblem("adjustment", -1), null);
  assert.match(signProblem("adjustment", 0), /zero/);
  assert.match(signProblem("insurance", -12.5), /whole number/);
  assert.equal(signedForType("partner_payout", 620500), -620500);
  assert.equal(signedForType("refund", -500), 500);
  assert.equal(signedForType("adjustment", -300), -300);
});

test("UPDATE and DELETE are refused for the application roles; a correction is a reversing entry", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.cost_entry from service_role, tenant_app;/);
  assert.match(sql, /create trigger cost_entry_guard before update or delete on public\.cost_entry/);
  assert.match(sql, /raise exception 'A cost entry is never removed; write a reversing entry instead\.'/);
  // The one change allowed: when money moved, once, nothing else.
  assert.match(sql, /if old\.paid_on is null and new\.paid_on is not null\n\s+and \(to_jsonb\(new\) - 'paid_on'\) = \(to_jsonb\(old\) - 'paid_on'\) then/);
  assert.match(sql, /reverses_entry_id, reversal_reason\)\n\s+values \(o\.tenant_id, o\.agency_id, o\.entry_type, -o\.amount_cents/);
  assert.match(sql, /create unique index if not exists cost_entry_one_reversal/);
});

test("accrual and cash are two dates, and both bases read from the database", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /incurred_on date not null,\n\s+paid_on date,/);
  assert.match(sql, /m\.paid_on >= p_from and m\.paid_on < p_to/);
  assert.match(sql, /m\.incurred_on >= p_from and m\.incurred_on < p_to/);
  assert.deepEqual(monthPeriod("2026-08"), { from: "2026-08-01", to: "2026-09-01" });
  assert.deepEqual(monthPeriod("2026-12"), { from: "2026-12-01", to: "2027-01-01" });
  assert.equal(monthPeriod("2026-13"), null);
});

test("the view unions both sides in one shape, and resolves a commission's lead source like the scorecards do", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create or replace view public\.money_entry\nwith \(security_invoker = true\) as/);
  assert.equal((sql.match(/\bunion all\b/g) ?? []).length, 2, "commission_entry + commission_account_entry + cost_entry");
  // Annotation wins, else policy_current; a campaign supplies its vendor. Joined on both primary keys.
  assert.match(sql, /left join public\.policy_current pc on pc\.tenant_id = e\.tenant_id and pc\.carrier_id = e\.carrier_id and pc\.policy_number = e\.policy_number/);
  assert.match(sql, /left join public\.policy_annotation a on a\.tenant_id = e\.tenant_id and a\.carrier_id = e\.carrier_id and a\.policy_number = e\.policy_number/);
  assert.match(read("lib/ingestion/scorecardsStore.ts"), /n && \(n\.lead_vendor_id \|\| n\.lead_campaign_id\) \? n\.lead_vendor_id \?\? campaign\.get\(n\.lead_campaign_id\)\?\.vendor_id : r\.vendor_id \?\? campaign\.get\(r\.campaign_id\)\?\.vendor_id/);
});

test("no code path in LA-7 inserts into or updates the commission ledger", () => {
  const files = la7Files();
  assert.ok(files.length >= 3, "the scan finds LA-7's files");
  const writes = /(insert\s+into|update|delete\s+from|truncate)\s+(public\.)?commission_(account_)?entry\b|from\(\s*["']commission_(account_)?entry["']\s*\)\s*\.\s*(insert|update|upsert|delete)|record_(commission|account)_entries/i;
  for (const f of files) assert.doesNotMatch(read(f), writes, f);
});

test("no float in the ingestion, storage or aggregation path", () => {
  for (const f of la7Files().filter((p) => p.startsWith("lib/accounting/") && !p.endsWith(".sql"))) {
    const src = read(f);
    assert.doesNotMatch(src, /parseFloat|toFixed\(|Math\.round\(|\* 100\b|\/ 100\b/, f);
  }
  const sql = read(MIGRATION);
  assert.match(sql, /amount_cents bigint not null/);
  const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  assert.doesNotMatch(code, /\b(numeric|real|double precision|float[48]?)\b/);
  assert.match(sql, /\(p_entry->>'amount_cents'\) !~ '\^-\?\[0-9\]\+\$'/, "the writer refuses a fractional amount rather than rounding it");
  assert.deepEqual(totals([{ side: "commission", entryType: "advance", amountCents: 1842000, entries: 1 }, { side: "cost", entryType: "lead_cost", amountCents: -1129400, entries: 3 }]), { moneyInCents: 1842000, moneyOutCents: -1129400, netCents: 712600 });
});

test("only the database's writers touch cost_entry", () => {
  const store = read("lib/accounting/costLedger.ts");
  assert.doesNotMatch(store, /from\("cost_entry"\)\.(insert|update|upsert|delete)/);
  for (const fn of ["record_cost_entry", "reverse_cost_entry", "mark_cost_entries_paid", "money_net"]) {
    assert.match(store, new RegExp(`rpc\\("${fn}"`), fn);
    assert.match(read(MIGRATION), new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`), fn);
  }
});
