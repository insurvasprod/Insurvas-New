// Run with: npm test
//
// Lapse risk: the order the page promises in one line (URGENCY_RULE), and the commission figure
// each row carries from the ledger. Both are read by a person deciding which customer to call
// first, so both are asserted rather than eyeballed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeLedger } from "../ledger/compute.ts";
import { exposureFor, monthlyPremiumCents, rankAtRisk, totalsAtRisk, URGENCY_RULE } from "./model.ts";

const signal = (kind, occurredOn, extra = {}) => ({ id: `${kind}-${occurredOn}-${Math.random()}`, kind, occurredOn, note: null, source: "manual", recordedAt: `${occurredOn}T12:00:00Z`, recordedByName: "Ray", ...extra });
const atRisk = (policyNumber, signals, exposure = { state: "outside_window" }, extra = {}) => ({
  policyId: policyNumber,
  policyNumber,
  insuredName: "Grace",
  carrier: "Mutual of Omaha",
  product: "final_expense",
  status: "active",
  annualPremiumCents: 120000,
  monthlyPremiumCents: 10000,
  signals,
  exposure,
  ...extra,
});
const exposed = (cents) => ({ state: "exposed", cents, clawbackEndsOn: "2027-03-01", clawbackType: "full" });
const order = (rows) => rankAtRisk(rows).map((row) => row.policyNumber);

test("the most serious signal decides first: returned payment, then missed draft, then service call, then other", () => {
  const rows = [
    atRisk("OTHER", [signal("other", "2026-01-01", { note: "Customer moved" })], exposed(900000)),
    atRisk("CALL", [signal("service_call", "2026-01-01")], exposed(500000)),
    atRisk("DRAFT", [signal("missed_draft", "2026-09-20")]),
    atRisk("RETURNED", [signal("returned_payment", "2026-09-23")]),
  ];
  // Seniority and exposure never lift a service call above a returned payment.
  assert.deepEqual(order(rows), ["RETURNED", "DRAFT", "CALL", "OTHER"]);
});

test("a lesser signal on the same policy does not lower it, and more open signals rank higher", () => {
  const rows = [
    atRisk("ONE-DRAFT", [signal("missed_draft", "2026-09-01")]),
    atRisk("DRAFT-AND-CALL", [signal("service_call", "2026-09-20"), signal("missed_draft", "2026-09-10")]),
  ];
  assert.deepEqual(order(rows), ["DRAFT-AND-CALL", "ONE-DRAFT"]);
});

test("then the oldest open signal, then the larger commission exposed, then policy number", () => {
  assert.deepEqual(
    order([atRisk("NEWER", [signal("missed_draft", "2026-09-20")], exposed(900000)), atRisk("OLDER", [signal("missed_draft", "2026-09-02")])]),
    ["OLDER", "NEWER"],
    "the policy at risk longest comes first, whatever it would cost",
  );
  assert.deepEqual(
    order([atRisk("SMALL", [signal("missed_draft", "2026-09-02")], exposed(1000)), atRisk("BIG", [signal("missed_draft", "2026-09-02")], exposed(50000)), atRisk("NONE", [signal("missed_draft", "2026-09-02")])]),
    ["BIG", "SMALL", "NONE"],
  );
  assert.deepEqual(order([atRisk("B-2", [signal("service_call", "2026-09-02")]), atRisk("A-1", [signal("service_call", "2026-09-02")])]), ["A-1", "B-2"], "ties never shuffle");
});

test("signals inside a row read most serious first, then oldest", () => {
  const [row] = rankAtRisk([atRisk("P", [signal("service_call", "2026-09-01"), signal("missed_draft", "2026-09-15"), signal("missed_draft", "2026-09-05")])]);
  assert.deepEqual(row.signals.map((s) => [s.kind, s.occurredOn]), [["missed_draft", "2026-09-05"], ["missed_draft", "2026-09-15"], ["service_call", "2026-09-01"]]);
});

test("the rule the page prints names the order the code implements", () => {
  const positions = ["returned payment", "missed draft", "service call", "more open signals", "oldest signal", "commission exposed"].map((phrase) => URGENCY_RULE.indexOf(phrase));
  assert.ok(positions.every((at) => at >= 0), `URGENCY_RULE is missing a step: ${URGENCY_RULE}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "URGENCY_RULE lists the steps out of order");
});

// ── exposure mapping ─────────────────────────────────────────────────────────

const schedule = (id, policy_year, rate_bp) => ({ id, tenant_id: "t", carrier_id: "moo", product_code: "final_expense", contract_level_bp: 11750, policy_year, rate_bp, effective_from: "2025-01-01", created_at: "2025-01-01" });
const library = {
  carriers: [{ id: "moo", code: "mutual_of_omaha", name: "Mutual of Omaha" }],
  products: [{ code: "final_expense", name: "Final expense" }],
  tenantCarriers: [{ carrier_id: "moo", contract_level_bp: 11750, effective_from: "2025-01-01" }],
  commissionSchedules: [schedule("y1", 1, 10000), schedule("y2", 2, 500)],
  advanceRules: [{ id: "adv", carrier_id: "moo", product_code: "final_expense", advance_months: 9, advance_pct_bp: 7500, clawback_months: 12, clawback_type: "full", effective_from: "2025-01-01" }],
};
const book = (overrides) => ({ id: "p1", policyNumber: "POL-1", insuredName: "Grace", carrier: "Mutual of Omaha", product: "final_expense", effectiveDate: "2026-06-01", annualPremiumCents: 100000, status: "active", statusChangedAt: null, createdBy: "u1", ...overrides });

test("a policy inside its clawback window exposes exactly what the ledger would charge back", () => {
  const ledger = computeLedger([book({})], library, "2026-09-24");
  const mapped = exposureFor({ id: "p1", status: "active" }, ledger);
  assert.equal(mapped.state, "exposed");
  assert.equal(mapped.cents, ledger.exposure[0].exposureCents, "the row shows the ledger's own figure, not a recomputation");
  assert.equal(mapped.cents, 75000, "a full clawback takes back the whole 75% advance on $1,000 of year-one commission");
  assert.equal(mapped.clawbackEndsOn, "2027-06-01");
});

test("past the clawback window reads as outside it, not as zero exposure invented", () => {
  const ledger = computeLedger([book({ effectiveDate: "2025-01-15" })], library, "2026-09-24");
  assert.deepEqual(ledger.exposure, []);
  assert.deepEqual(exposureFor({ id: "p1", status: "active" }, ledger), { state: "outside_window" });
});

test("a pending policy and an unpriceable one are not called 'outside the window'", () => {
  const pending = computeLedger([book({ status: "pending" })], library, "2026-09-24");
  assert.deepEqual(exposureFor({ id: "p1", status: "pending" }, pending), { state: "not_issued" });

  const unknownCarrier = computeLedger([book({ carrier: "Nobody Mutual" })], library, "2026-09-24");
  const mapped = exposureFor({ id: "p1", status: "active" }, unknownCarrier);
  assert.equal(mapped.state, "no_rule");
  assert.match(mapped.reason, /Nobody Mutual/);
});

test("totals add premium and only the exposure that has a figure", () => {
  const totals = totalsAtRisk([
    atRisk("A", [signal("missed_draft", "2026-09-01")], exposed(75000), { annualPremiumCents: 120000, monthlyPremiumCents: monthlyPremiumCents(120000) }),
    atRisk("B", [signal("service_call", "2026-09-01")], { state: "no_rule", reason: "x" }, { annualPremiumCents: 70080, monthlyPremiumCents: monthlyPremiumCents(70080) }),
    atRisk("C", [signal("service_call", "2026-09-01")], { state: "outside_window" }, { annualPremiumCents: 0, monthlyPremiumCents: 0 }),
  ]);
  assert.deepEqual(totals, { policies: 3, annualPremiumCents: 190080, monthlyPremiumCents: 10000 + 5840, commissionExposedCents: 75000, unpriced: 1 });
});

// ── the migration keeps its promises ─────────────────────────────────────────

test("lapse signals are never deleted, 'other' needs a reason, and a lapse resolution lapses the policy", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20260924265000_policy_lapse_signals.sql"), "utf8");
  assert.match(sql, /revoke delete on public\.tenant_policy_lapse_signals from service_role/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*tenant_policy_lapse_signals/i);
  assert.match(sql, /kind <> 'other' or \(note is not null/);
  assert.match(sql, /p_resolution = 'policy_lapsed'[\s\S]*update public\.tenant_policies set status = 'lapsed'/);
  for (const kind of ["missed_draft", "returned_payment", "service_call", "other"]) assert.match(sql, new RegExp(`'${kind}'`));
  for (const resolution of ["payment_received", "policy_reinstated", "policy_lapsed", "false_alarm"]) assert.match(sql, new RegExp(`'${resolution}'`));
});
