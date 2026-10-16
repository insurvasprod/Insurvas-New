// LA-4.7 (Notion sprint) · policy_current's computed fields.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { annualisedPremiumCents, computeCurrent, countdown, daysPastDue, effectiveStatus, inClawbackWindow, monthsPaid, riskBand, ruleTypeFor } from "./policyCurrent.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008160000_la_4_7_policy_current.sql");
const base = { asOf: "2026-10-07", status: "active", paidToDate: "2026-10-01", effectiveDate: "2026-01-01", premiumCents: 5000, premiumMode: "monthly", rule: { windowDays: 45, graceDays: 30 }, clawbackMonths: 12 };

test("annualised premium is correct for all four modes, and null without one", () => {
  assert.equal(annualisedPremiumCents(5000, "monthly"), 60000);
  assert.equal(annualisedPremiumCents(15000, "quarterly"), 60000);
  assert.equal(annualisedPremiumCents(30000, "semiannual"), 60000);
  assert.equal(annualisedPremiumCents(60000, "annual"), 60000);
  assert.equal(annualisedPremiumCents(5000, null), null);
  assert.equal(annualisedPremiumCents(null, "monthly"), null);
  assert.equal(annualisedPremiumCents(5000, "weekly"), null);
});

test("days past due comes from the paid-to date and moves with the clock, with no new file", () => {
  assert.equal(daysPastDue("2026-10-07", "2026-10-01"), 6);
  assert.equal(daysPastDue("2026-10-08", "2026-10-01"), 7, "one day later, one more day");
  assert.equal(daysPastDue("2026-11-01", "2026-10-01"), 31);
  assert.equal(daysPastDue("2026-09-20", "2026-10-01"), 0, "paid ahead is floored at 0");
  assert.equal(daysPastDue("2026-10-07", null), null);
  const day = (asOf) => computeCurrent({ ...base, asOf });
  assert.deepEqual([day("2026-10-07").daysPastDue, day("2026-10-08").daysPastDue, day("2026-10-09").daysPastDue], [6, 7, 8]);
  assert.deepEqual([day("2026-10-07").daysUntilCarrierCloses, day("2026-10-08").daysUntilCarrierCloses], [39, 38]);
});

test("the SQL measures from paid_to_date, never from the snapshot date", () => {
  assert.match(sql, /greatest\(0, z\.as_of - l\.paid_to_date\)/);
  assert.doesNotMatch(sql, /as_of - l\.snapshot_date|current_date - [a-z.]*snapshot_date/);
});

test("no carrier rule, no countdown: null, never zero or a default", () => {
  assert.equal(computeCurrent({ ...base, rule: null }).daysUntilCarrierCloses, null);
  assert.equal(computeCurrent({ ...base, rule: { windowDays: null, graceDays: 5 } }).daysUntilCarrierCloses, null);
  assert.equal(countdown("lapsed", 45, 10), null, "only while it is in force");
  assert.equal(countdown("active", 45, null), null, "and only with a paid-to date");
  assert.equal(countdown("at_risk", 45, 50), -5);
});

test("first payment window until a payment is on record, then ongoing", () => {
  assert.equal(ruleTypeFor("2026-01-01", null), "first_payment");
  assert.equal(ruleTypeFor("2026-01-01", "2026-01-01"), "first_payment");
  assert.equal(ruleTypeFor("2026-01-01", "2026-02-01"), "ongoing_payment");
});

test("months paid: whole months, like Postgres age()", () => {
  assert.equal(monthsPaid("2026-01-01", "2026-10-01"), 9);
  assert.equal(monthsPaid("2026-01-31", "2026-02-28"), 0);
  assert.equal(monthsPaid("2026-01-31", "2026-03-31"), 2);
  assert.equal(monthsPaid("2025-11-15", "2026-02-14"), 2);
  assert.equal(monthsPaid("2026-03-01", "2026-02-01"), 0);
  assert.equal(monthsPaid(null, "2026-02-01"), null);
});

test("derived at_risk: active past grace is at_risk, the same value the status map gives", () => {
  assert.equal(effectiveStatus("active", 31, 30), "at_risk");
  assert.equal(effectiveStatus("active", 30, 30), "active", "on the last grace day it is still active");
  assert.equal(effectiveStatus("active", 90, null), "active", "no grace rule, no derivation");
  assert.equal(effectiveStatus("lapsed", 90, 30), "lapsed");
  const derived = computeCurrent({ ...base, paidToDate: "2026-09-01" });
  const mapped = computeCurrent({ ...base, paidToDate: "2026-09-01", status: "at_risk" });
  assert.deepEqual(derived, mapped, "derived and mapped at_risk give identical rows");
  assert.match(sql, /then 'at_risk' else r\.status_normalized end as status_eff/);
});

test("risk band: observed facts only", () => {
  assert.equal(riskBand({ status: "active", dpd: 0, untilCloses: 45, inClawback: true }), "none");
  assert.equal(riskBand({ status: "active", dpd: 5, untilCloses: 40, inClawback: true }), "watch");
  assert.equal(riskBand({ status: "at_risk", dpd: 35, untilCloses: 10, inClawback: false }), "at_risk");
  assert.equal(riskBand({ status: "at_risk", dpd: 35, untilCloses: 10, inClawback: true }), "critical");
  assert.equal(riskBand({ status: "at_risk", dpd: 50, untilCloses: -5, inClawback: null }), "critical");
  assert.equal(riskBand({ status: "at_risk", dpd: 50, untilCloses: null, inClawback: null }), "at_risk", "unknown is not critical");
  assert.equal(riskBand({ status: "lapsed", dpd: 90, untilCloses: null, inClawback: true }), "none");
  assert.equal(inClawbackWindow(9, 12), true);
  assert.equal(inClawbackWindow(12, 12), false);
  assert.equal(inClawbackWindow(9, null), null);
});

test("no predictive input is readable from the table", () => {
  const table = sql.match(/create table if not exists public\.policy_current \(([\s\S]*?)\n\);/)[1];
  assert.doesNotMatch(table, /predict|score|probab|likelihood|propensity|model/i);
  assert.match(table, /risk_band text not null/);
});

test("the migration: one writer, rebuildable, money fields wait for the ledger", () => {
  assert.match(sql, /revoke insert, update, delete, truncate on public\.policy_current from service_role, tenant_app/);
  assert.match(sql, /delete from public\.policy_current pc\s+where/);
  assert.doesNotMatch(sql.match(/create table if not exists public\.policy_current \(([\s\S]*?)\n\);/)[1], /now\(\)|computed_at|updated_at/, "no clock in a row, so a rebuild is identical");
  const insert = sql.match(/insert into public\.policy_current \(([\s\S]*?)\)\n/)[1];
  for (const column of ["total_advanced_cents", "total_earned_cents", "total_charged_back_cents", "unearned_advance_cents", "contact_id", "household_id", "agent_user_id", "lead_cost_cents"]) {
    assert.ok(!insert.includes(column), `${column} stays null until its task ships`);
  }
  assert.match(sql, /zones as materialized \(/, "the timezone lookup runs once per agency (inlined it took 29 s for 50,000 policies)");
  assert.match(sql, /cron\.schedule\('la4-policy-current-daily'/);
  assert.match(sql, /v_rows := public\.refresh_policy_current_daily\(\)/, "the job is run once in the check block");
});

test("a rule change and a parsed file both refresh Layer 3", () => {
  assert.match(read("lib/ingestion/snapshotStore.ts"), /refreshPolicyCurrent\(\{ tenantId, carrierId: input\.carrierId, policies: chunk \}\)/);
  assert.match(read("lib/ingestion/carrierRulesStore.ts"), /await recount\(/);
});

test("the clawback window and the policy's advance rule find the rule through the product family", () => {
  const fix = read("supabase/migrations/20261008300000_la_4_advance_rule_product_family.sql");
  // The agency's mapping, then the platform's, then the carrier's code as it is.
  assert.match(fix, /\(select f\.product_code from public\.carrier_product_family f where f\.tenant_id = d\.tenant_id and f\.carrier_id = d\.carrier_id and f\.carrier_product_code = d\.product_code limit 1\),\s*\(select f\.product_code from public\.carrier_product_family f where f\.tenant_id is null and f\.carrier_id = d\.carrier_id and f\.carrier_product_code = d\.product_code limit 1\),\s*d\.product_code\) as family/);
  assert.match(fix, /a\.product_code = fam\.family and a\.effective_from <= d\.as_of/);
  assert.doesNotMatch(fix, /a\.product_code = d\.product_code/);
  // Otherwise the function is the 4.8 one: the links it fills are still there.
  assert.match(fix, /left join public\.policy_match pm on pm\.tenant_id = c\.tenant_id/);
  assert.match(fix, /if v_after <> v_before then/);
  const ledger = read("lib/ingestion/commissionLedgerStore.ts");
  assert.match(ledger, /export async function productFamilyOf\(/);
  assert.match(ledger, /\.eq\("product_code", family\)/);
  assert.match(ledger, /rows\.find\(\(r\) => r\.tenant_id === tenantId\)\?\.product_code \?\? rows\.find\(\(r\) => r\.tenant_id === null\)\?\.product_code \?\? carrierProductCode/);
});

test("an approved policy waiting for its first premium counts down on the first-payment rule", async () => {
  const { riskFootnote } = await import("./policyCurrent.ts");
  const approved = { ...base, status: "approved_unpaid", paidToDate: null, effectiveDate: "2026-10-01", rule: { windowDays: 10, graceDays: 3 } };
  const day = (asOf, over = {}) => computeCurrent({ ...approved, asOf, ...over });
  assert.equal(day("2026-09-28").ruleType, "first_payment");
  assert.deepEqual([day("2026-09-28").daysPastDue, day("2026-09-28").daysUntilCarrierCloses, day("2026-09-28").riskBand], [0, 10, "none"], "before the effective date: not late");
  assert.deepEqual([day("2026-10-03").daysPastDue, day("2026-10-03").daysUntilCarrierCloses, day("2026-10-03").riskBand], [2, 8, "watch"], "late, inside the grace");
  assert.deepEqual([day("2026-10-07").daysUntilCarrierCloses, day("2026-10-07").riskBand], [4, "at_risk"], "past the 3-day grace");
  assert.deepEqual([day("2026-10-12").daysUntilCarrierCloses, day("2026-10-12").riskBand], [-1, "critical"], "the window has run out");
  assert.equal(day("2026-10-07").status, "approved_unpaid", "the status stays the carrier's");
  assert.equal(day("2026-10-07", { paidToDate: "2026-10-01" }).daysPastDue, 6, "a paid-to equal to the effective date: still nothing drawn");
  // No first-payment rule: no countdown, never a default — but it still reads as late.
  assert.deepEqual([day("2026-10-07", { rule: null }).daysUntilCarrierCloses, day("2026-10-07", { rule: null }).riskBand], [null, "watch"]);
  // Nothing changes for an active policy with no paid-to date: no invented lateness.
  assert.equal(computeCurrent({ ...base, paidToDate: null }).daysPastDue, null);
  // The policy page's line under the risk.
  assert.equal(riskFootnote({ status: "approved_unpaid", daysLeft: 4, daysPastDue: 6, paidTo: null }), "4 days until the carrier closes it");
  assert.equal(riskFootnote({ status: "approved_unpaid", daysLeft: null, daysPastDue: 0, paidTo: null }), "first premium not drawn yet");
  assert.match(riskFootnote({ status: "approved_unpaid", daysLeft: null, daysPastDue: 6, paidTo: null }), /first premium not drawn, 6 days late; no first-payment window/);
  assert.equal(riskFootnote({ status: "active", daysLeft: null, daysPastDue: null, paidTo: null }), "no paid-to date from the carrier");
  assert.equal(riskFootnote({ status: "active", daysLeft: null, daysPastDue: 0, paidTo: "2026-10-01" }), "paid up to date");
  assert.equal(riskFootnote({ status: "at_risk", daysLeft: -2, daysPastDue: 50, paidTo: "2026-08-01" }), "the carrier's window has run out");
});

test("20261015520000 is the live function plus the first-payment edits, and checks itself", () => {
  const fix = read("supabase/migrations/20261015520000_la_4_first_payment_countdown.sql");
  assert.match(fix, /case when l\.status_normalized = 'approved_unpaid' and l\.effective_date is not null and \(l\.paid_to_date is null or l\.paid_to_date <= l\.effective_date\)\s+then greatest\(0, z\.as_of - l\.effective_date\)/);
  assert.match(fix, /s\.status_eff in \('active', 'at_risk', 'approved_unpaid'\)/);
  assert.match(fix, /carrier_product_family f where f\.tenant_id = d\.tenant_id/, "the product-family fix stays");
  assert.match(fix, /revoke all on function public\.refresh_policy_current\(uuid, uuid, text\[\], date\) from public, anon, authenticated;\ngrant execute on function public\.refresh_policy_current\(uuid, uuid, text\[\], date\) to service_role;/);
  assert.doesNotMatch(fix, /\S+create or replace/, "no comment line swallows the create");
});
