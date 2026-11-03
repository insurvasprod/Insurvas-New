// LA-7.5 (Notion sprint, Module 7 — Accounting) · producer commission splits and payouts.
// Run with: node --experimental-strip-types --test lib/accounting/producers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { percent, producerView } from "./producersCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015250000_la_7_5_producer_splits.sql";

test("a split resolves most specific first, null meaning all, then the latest in force on the date", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /and \(s\.carrier_id is null or s\.carrier_id = p_carrier\) and \(s\.product_code is null or s\.product_code = p_product\)/);
  assert.match(sql, /order by \(s\.carrier_id is not null and s\.product_code is not null\) desc, \(s\.carrier_id is not null\) desc, \(s\.product_code is not null\) desc, s\.effective_from desc/);
  assert.match(sql, /create trigger producer_split_guard before update or delete on public\.producer_split/, "a split changes only by a new effective-dated row");
});

test("a chargeback is split at the rate of the sale it claws back, not today's", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /case when s\.kind = 'chargeback' then coalesce\(\(select min\(coalesce\(a\.transaction_date, a\.statement_date\)\) from public\.commission_entry a\n\s+where a\.tenant_id = s\.tenant_id and a\.carrier_id = s\.carrier_id and a\.policy_number = s\.policy_number and a\.entry_type = 'advance'\), s\.on_date\)/);
  assert.match(sql, /cross join lateral public\.resolve_producer_split\(d\.tenant_id, d\.producer, d\.carrier_id, d\.product_code, d\.split_on\) sp/);
});

test("every producer entry points at the commission entry that caused it, once", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /constraint producer_ledger_caused check \(\(entry_type in \('split_advance', 'split_earned', 'split_chargeback'\)\) = \(commission_entry_id is not null\)\)/);
  assert.match(sql, /create unique index if not exists producer_ledger_one_per_commission on public\.producer_ledger_entry \(commission_entry_id, producer_user_id\)/);
});

test("a negative balance is never clamped; the three policies; a write-off has a reason and a named actor", () => {
  const sql = read(MIGRATION);
  const build = sql.slice(sql.indexOf("create or replace function public.build_producer_run"), sql.indexOf("create or replace function public.publish_producer_run"));
  assert.match(build, /v_net := greatest\(v_due, 0\);/, "carry forward: nothing until it clears");
  assert.match(build, /v_withheld := least\(-v_before, public\.bp_share\(greatest\(v_period, 0\), v_cap\)\);/, "cap: only the configured share");
  assert.match(sql, /balance_after_cents = balance_before_cents \+ earned_cents \+ clawed_back_cents - net_cents/, "the balance after carries the negative forward");
  assert.doesNotMatch(build, /balance_after[^;]*greatest\(/, "the balance itself is never floored");
  assert.match(sql, /raise exception 'write_off_producer_balance: a write-off is made by a named person'/);
  assert.match(sql, /left\('Written off: ' \|\| btrim\(p_reason\), 500\), p_by\);/);
  assert.match(sql, /add column if not exists producer_negative_policy text not null default 'carry_forward'/);
});

test("publishing writes one cost entry; paid sets only paid_on; LA-4.12 is only read", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /'entry_type', 'producer_split', 'amount_cents', -r\.net_cents,\n\s+'incurred_on', r\.period_end/);
  assert.match(sql, /v_n := public\.mark_cost_entries_paid\(p_tenant_id, v_ids, p_paid_on\);/);
  assert.doesNotMatch(sql, /(insert into|update|delete from) public\.commission_entry/);
});

test("a producer sees only their own balance, entries and runs — and no agency commission figure", () => {
  const view = producerView({
    balanceCents: -15000,
    entries: [{ id: "e1", entryType: "split_chargeback", policyNumber: "P-AUG", carrierId: "c", commissionEntryId: "ce-secret", splitPctBpApplied: 5500, amountCents: -55000, occurredOn: "2026-11-05", payoutRunId: null, reason: null }],
    runs: [
      { id: "r1", periodStart: "2026-08-01", periodEnd: "2026-08-31", status: "paid", negativePolicy: "carry_forward", balanceBeforeCents: 0, earnedCents: 55000, clawedBackCents: 0, withheldCents: 0, netCents: 55000, balanceAfterCents: 0, paidOn: "2026-09-05" },
      { id: "r2", periodStart: "2026-12-01", periodEnd: "2026-12-31", status: "draft", negativePolicy: "carry_forward", balanceBeforeCents: 0, earnedCents: 1, clawedBackCents: 0, withheldCents: 0, netCents: 1, balanceAfterCents: 0, paidOn: null },
    ],
  });
  assert.equal(view.owesAgency, true);
  assert.equal(view.runs.length, 1, "a draft run is not the producer's yet");
  const json = JSON.stringify(view);
  assert.ok(!json.includes("ce-secret"), "no link to the commission entry");
  assert.deepEqual(Object.keys(view.entries[0]).sort(), ["amountCents", "id", "label", "occurredOn", "policyNumber", "reason"], "no percentage to work the agency's gross back from");
  assert.doesNotMatch(json, /commission|pct|gross/i);
  // The producer's route is the producer's alone, and reads only the session's own user id.
  const route = read("app/api/app/accounting/my-balance/route.ts");
  assert.match(route, /myBalance\(auth\.context\.tenantId, auth\.context\.userId\)/);
  assert.doesNotMatch(route, /searchParams|params|request\.json/);
  // Across every accounting route: only my-balance admits a producer.
  for (const p of AGENT_API_POLICIES.filter((x) => x.sourceFile.startsWith("app/api/app/accounting/"))) {
    if (p.sourceFile === "app/api/app/accounting/my-balance/route.ts") assert.deepEqual(p.allowedRoles, ["producer"]);
    else assert.ok(!p.allowedRoles.includes("producer"), `${p.sourceFile} admits a producer`);
  }
  // And the agency can switch the producer view off (LA-7.9); it defaults on.
  assert.match(read(MIGRATION), /add column if not exists producers_see_balance boolean not null default true/);
  assert.match(read("lib/accounting/producerStore.ts"), /if \(settings && settings\.producers_see_balance === false\) return \{ visible: false as const \};/);
});

test("percentages print from basis points without a float", () => {
  assert.equal(percent(6000), "60%");
  assert.equal(percent(5550), "55.5%");
  assert.equal(percent(5525), "55.25%");
  assert.equal(percent(0), "0%");
});
