// Team payouts (owner's Accounting doc, "Team Payouts", 2026-11-07): pay plans and the monthly run.
// Run with: node --experimental-strip-types --test lib/agency/payPlans.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bpShare, chargebackSummary, defaultChoice, draftPay, monthRange, normalizePlan, parsePctToBp, pctOf, planProblem, planSummary, previousMonth } from "./payPlanCore.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SQL = "supabase/migrations/20261107100000_team_pay_plans.sql";
const plan = (over) => ({ model: "salary_bonus", baseCents: 200000, salesPctBp: 1000, appBonusCents: 2500, saveFeeCents: 0, chargebacksApply: false, effectiveFrom: "2026-09-01", ...over });

test("the three models in one line each, as the Pay plans list shows them", () => {
  assert.equal(planSummary(plan({ model: "solo_owner" })), "Keeps 100% of commission");
  assert.equal(planSummary(plan({ model: "sidekick", saveFeeCents: 2000 })), "$20.00 per saved deal");
  assert.equal(planSummary(plan()), "$2,000.00 a month · 10% of their sales · $25.00 per submitted app");
  assert.equal(planSummary(plan({ model: "big_split", salesPctBp: 7000 })), "Agent 70% / agency 30%");
  assert.equal(chargebackSummary(plan()), "Off · agency absorbs");
  assert.equal(chargebackSummary(plan({ chargebacksApply: true })), "Pays back 10%");
  assert.equal(chargebackSummary(plan({ model: "big_split", salesPctBp: 7000 })), "Pays back 70%");
});

test("the form refuses what the database would", () => {
  assert.equal(planProblem(plan()), null);
  assert.match(planProblem(plan({ model: "sidekick", saveFeeCents: 0 })), /saved deal/);
  assert.match(planProblem(plan({ model: "big_split", salesPctBp: 0 })), /share of the split/);
  assert.match(planProblem(plan({ salesPctBp: null })), /share/);
  assert.match(planProblem(plan({ effectiveFrom: "" })), /date/);
  assert.match(planProblem(plan({ baseCents: -1 })), /negative/);
  // A model's stray fields are cleared, and a big split always takes chargebacks back.
  assert.deepEqual(normalizePlan(plan({ model: "big_split", salesPctBp: 7000, chargebacksApply: false })), plan({ model: "big_split", salesPctBp: 7000, baseCents: 0, appBonusCents: 0, chargebacksApply: true }));
  assert.equal(normalizePlan(plan({ model: "solo_owner" })).salesPctBp, null);
});

test("the draft's three choices for someone below zero (the round 1 example: Priya)", () => {
  const priya = { beforeCents: -250000, periodCents: 100000 };
  assert.deepEqual(draftPay(priya, "withhold"), { payCents: 0, takenCents: 100000, forgivenCents: 0, afterCents: -150000 }, "Carry it: owes $1,500 next month");
  assert.deepEqual(draftPay(priya, "recover", 2000), { payCents: 50000, takenCents: 50000, forgivenCents: 0, afterCents: -200000 }, "Take 20%: paid $500, still owes $2,000");
  assert.deepEqual(draftPay(priya, "forgive"), { payCents: 100000, takenCents: 0, forgivenCents: 250000, afterCents: 0 }, "Let it go: paid the month, owes nothing");
  // A month that is itself negative: forgiving resets to zero, nothing is paid.
  assert.deepEqual(draftPay({ beforeCents: 0, periodCents: -40000 }, "forgive"), { payCents: 0, takenCents: 0, forgivenCents: 40000, afterCents: 0 });
  // Take a share never takes more than the month earned.
  assert.equal(draftPay({ beforeCents: -1000000, periodCents: 30000 }, "recover", 5000).takenCents, 30000);
  assert.deepEqual(draftPay({ beforeCents: 0, periodCents: 299000 }, "pay_full"), { payCents: 299000, takenCents: 0, forgivenCents: 0, afterCents: 0 });
});

test("money and dates, without float", () => {
  assert.equal(bpShare(250000, 2000), 50000);
  assert.equal(bpShare(5, 5000), 3, "half away from zero, like bp_share in SQL");
  assert.equal(pctOf(7000), "70%");
  assert.equal(pctOf(1250), "12.5%");
  assert.equal(parsePctToBp("70"), 7000);
  assert.equal(parsePctToBp("12.5%"), 1250);
  assert.equal(parsePctToBp("101"), null);
  assert.equal(parsePctToBp("abc"), null);
  assert.deepEqual(monthRange("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(previousMonth("2026-01-15"), "2025-12");
  assert.equal(defaultChoice("cap"), "recover");
  assert.equal(defaultChoice("write_off"), "forgive");
  assert.equal(defaultChoice(undefined), "withhold");
});

test("the database: plans, the commission writer, the three new lines, the run's choices", () => {
  const sql = read(SQL);
  assert.match(sql, /constraint producer_pay_plan_model check \(model in \('solo_owner', 'sidekick', 'salary_bonus', 'big_split'\)\)/);
  assert.match(sql, /'salary', 'app_bonus', 'save_fee'\)\);/, "the ledger accepts the three new lines");
  assert.match(sql, /create unique index if not exists producer_ledger_one_pay_source on public\.producer_ledger_entry \(tenant_id, producer_user_id, pay_source_key\)/, "a salary, bonus or fee is never posted twice");
  assert.match(sql, /'salary:' \|\| to_char\(m, 'YYYY-MM'\)/);
  assert.match(sql, /'app:' \|\| a\.lead_id/, "one bonus per client");
  assert.match(sql, /'save:' \|\| a\.carrier_id \|\| ':' \|\| a\.policy_number/, "one fee per policy saved");
  assert.match(sql, /\/\* pay plans \*\//, "the commission writer is patched, and says so");
  assert.match(sql, /if v_kind = ''chargeback'' and v_pp\.model is not null and not v_pp\.chargebacks_apply then v_amount := 0;/, "the chargeback switch");
  assert.match(sql, /decision_mode in \('pay_full', 'withhold', 'amount', 'recover', 'forgive'\)/);
  assert.match(sql, /v_adj := greatest\(-\(v_before \+ least\(v_month, 0\)\), 0\);/, "let it go writes off exactly what leaves them below zero");
  assert.match(sql, /v_take := least\(v_debt, public\.bp_share\(v_debt, coalesce\(d\.pct, v_cap\)\), greatest\(v_period, 0\)\);/, "take a share of the debt, never more than the month");
  assert.match(sql, /mark_producer_run_paid\(p_tenant_id, v_run, d\.paid_on, d\.method, d\.reference\)/, "each person paid their own way");
  const preview = sql.slice(sql.indexOf("create function public.agency_payout_preview"), sql.indexOf("revoke all on function public.agency_payout_preview"));
  assert.ok(preview.length > 500 && !/insert into|update public/i.test(preview), "the draft writes nothing");
});

test("a person can be switched back to contract level, and a mistaken line corrected", () => {
  assert.equal(planSummary(plan({ model: "contract_level" })), "Paid by contract level, as before");
  assert.deepEqual(normalizePlan(plan({ model: "contract_level" })), plan({ model: "contract_level", baseCents: 0, salesPctBp: null, appBonusCents: 0, chargebacksApply: true }));
  assert.equal(planProblem(normalizePlan(plan({ model: "contract_level" }))), null);
  const sql = read("supabase/migrations/20261107110000_pay_plan_contract_level.sql");
  assert.match(sql, /'big_split', 'contract_level'\)\)/);
  assert.match(sql, /coalesce\(v_plan\.model, ''contract_level''\) = ''contract_level''/, "the writer treats it as no plan");
  assert.match(sql, /create or replace function public\.adjust_producer_balance\(/);
});

test("a run counts base pay, bonuses and save fees as the month's money (found in the 2026-11-07 demo test)", () => {
  const sql = read("supabase/migrations/20261107120000_build_run_counts_pay_lines.sql");
  assert.ok(sql.includes("''chargeback'', ''salary'', ''app_bonus'', ''save_fee'')"), "the three pay lines join the builder's list");
  assert.match(sql, /expected the commission type list twice in build_producer_run/, "both of the builder's lists are patched, or nothing is");
});

test("routes are registered", () => {
  assert.ok(AGENT_API_POLICIES.some((p) => p.sourceFile === "app/api/app/agency/pay-plans/route.ts" && p.featureKey === "producer_payouts"));
  assert.match(read("lib/audit/actions.ts"), /"agency\.pay_plan_saved": "Team member pay plan saved"/);
});
