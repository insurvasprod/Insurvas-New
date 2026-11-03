import test from "node:test";
import assert from "node:assert/strict";

import { addMonths, chargebackCents, computeLedger, wholeMonthsBetween } from "./compute.ts";

const schedule = (id, policy_year, rate_bp, effective_from, extra = {}) => ({ id, tenant_id: "t", carrier_id: "moo", product_code: "final_expense", contract_level_bp: 11750, policy_year, rate_bp, effective_from, created_at: effective_from, ...extra });

const library = (overrides = {}) => ({
  carriers: [{ id: "moo", code: "mutual_of_omaha", name: "Mutual of Omaha" }],
  products: [{ code: "final_expense", name: "Final expense" }],
  tenantCarriers: [{ carrier_id: "moo", contract_level_bp: 11750, effective_from: "2025-01-01" }],
  commissionSchedules: [schedule("y1", 1, 11750, "2025-01-01"), schedule("y2", 2, 500, "2025-01-01"), schedule("y3", 3, 300, "2025-01-01", { applies_onward: true })],
  advanceRules: [],
  ...overrides,
});

const policy = (overrides = {}) => ({ id: "p1", policyNumber: "POL-1", insuredName: "Grace", carrier: "Mutual of Omaha", product: "final_expense", effectiveDate: "2025-03-01", annualPremiumCents: 100000, status: "active", statusChangedAt: null, createdBy: "u1", ...overrides });

test("each started policy year posts premium × that year's scheduled rate", () => {
  const { entries, gaps } = computeLedger([policy()], library(), "2026-09-24");
  assert.deepEqual(gaps, []);
  assert.deepEqual(entries.map((entry) => [entry.policyYear, entry.kind, entry.postedOn, entry.amountCents]).sort((a, b) => a[0] - b[0]), [
    [1, "commission", "2025-03-01", 117500],
    [2, "commission", "2026-03-01", 5000],
  ]);
  assert.equal(entries[0].scheduleId !== null, true, "every figure names the schedule row it came from");
});

test("rates are resolved on the issue date: a later raise never reprices a policy already issued", () => {
  const raised = library({ commissionSchedules: [...library().commissionSchedules, schedule("y1-raise", 1, 12500, "2026-01-01")] });
  const [old] = computeLedger([policy()], raised, "2026-09-24").entries.filter((entry) => entry.policyYear === 1);
  assert.equal(old.amountCents, 117500);
  const [fresh] = computeLedger([policy({ id: "p2", effectiveDate: "2026-02-01" })], raised, "2026-09-24").entries;
  assert.equal(fresh.amountCents, 125000);
});

test("the contract level is the one in force on the issue date", () => {
  const lib = library({ tenantCarriers: [{ carrier_id: "moo", contract_level_bp: 11750, effective_from: "2026-01-01" }] });
  const result = computeLedger([policy()], lib, "2026-09-24");
  assert.equal(result.entries.length, 0);
  assert.match(result.gaps[0].reason, /contract level/);
});

test("nothing is invented: an unknown carrier, product or missing rate is a gap", () => {
  const result = computeLedger([policy({ carrier: "Nobody Life" }), policy({ id: "p2", product: "Whole life" }), policy({ id: "p3", effectiveDate: "2024-06-01" })], library(), "2026-09-24");
  assert.equal(result.entries.length, 0);
  assert.equal(result.gaps.length, 3);
});

test("pending and future policies post nothing", () => {
  assert.equal(computeLedger([policy({ status: "pending" }), policy({ id: "p2", effectiveDate: "2027-01-01" })], library(), "2026-09-24").entries.length, 0);
});

test("with an advance rule, year one posts as an advance then the balance", () => {
  const lib = library({ advanceRules: [{ id: "r1", carrier_id: "moo", product_code: "final_expense", advance_months: 9, advance_pct_bp: 7500, clawback_months: 12, clawback_type: "prorated", effective_from: "2025-01-01" }] });
  const yearOne = computeLedger([policy()], lib, "2026-09-24").entries.filter((entry) => entry.policyYear === 1).sort((a, b) => a.postedOn.localeCompare(b.postedOn));
  assert.deepEqual(yearOne.map((entry) => [entry.kind, entry.postedOn, entry.amountCents]), [
    ["advance", "2025-03-01", 88125],
    ["commission", "2025-12-01", 29375],
  ]);
});

test("a lapse inside the clawback period charges the advance back; full takes it all, prorated the unexpired share", () => {
  const rule = (clawback_type) => ({ id: "r1", carrier_id: "moo", product_code: "final_expense", advance_months: 9, advance_pct_bp: 7500, clawback_months: 12, clawback_type, effective_from: "2025-01-01" });
  const lapsed = policy({ status: "lapsed", statusChangedAt: "2025-07-15T10:00:00Z" });
  const back = (type) => computeLedger([lapsed], library({ advanceRules: [rule(type)] }), "2026-09-24").entries.find((entry) => entry.kind === "chargeback");
  assert.equal(back("full").amountCents, -88125);
  // Four whole months in force (1 Mar → 15 Jul) of a twelve-month clawback: 8/12 of the advance.
  assert.equal(back("prorated").amountCents, -58750);
  assert.equal(back("full").postedOn, "2025-07-15");
  // No balance and no year two after the lapse.
  const all = computeLedger([lapsed], library({ advanceRules: [rule("full")] }), "2026-09-24").entries;
  assert.deepEqual(all.map((entry) => entry.kind).sort(), ["advance", "chargeback"]);
});

test("an active policy inside its clawback months is exposure on Lapse risk, not a chargeback", () => {
  const lib = library({ advanceRules: [{ id: "r1", carrier_id: "moo", product_code: "final_expense", advance_months: 9, advance_pct_bp: 7500, clawback_months: 12, clawback_type: "prorated", effective_from: "2025-01-01" }] });
  const result = computeLedger([policy({ effectiveDate: "2026-06-01" })], lib, "2026-09-24");
  assert.equal(result.entries.some((entry) => entry.kind === "chargeback"), false);
  assert.equal(result.exposure.length, 1);
  assert.equal(result.exposure[0].exposureCents, Math.round((88125 * 9) / 12));
  assert.equal(result.exposure[0].clawbackEndsOn, "2027-06-01");
  assert.equal(result.totals.exposureCents, result.exposure[0].exposureCents);
});

test("month arithmetic clamps to the end of the month", () => {
  assert.equal(addMonths("2025-01-31", 1), "2025-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(wholeMonthsBetween("2025-01-31", "2025-02-28"), 1);
  assert.equal(wholeMonthsBetween("2025-03-01", "2025-02-01"), 0);
  assert.equal(chargebackCents(1000, { clawback_months: 12, clawback_type: "prorated" }, 12), 0);
});
