// Run with: npm test
//
// LA-0.4: the library summary counts only the carriers the agency has switched on.
// contracts.ts imports its neighbours without an extension (Next resolves them), so the test adds
// ".ts" for relative imports before loading it.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
}`),
);
const { activeContract, carrierSwitchedOn, summarizeLibrary } = await import("./contracts.ts");

const contract = (carrier_id) => ({ id: `tc-${carrier_id}`, carrier_id, contract_level_bp: 10000, writing_number: "W1", effective_from: "2026-01-01", is_active: true });
const library = (carrierRequirements) => ({
  carriers: [{ id: "cardinal", name: "Cardinal Life" }, { id: "mutual", name: "Mutual Standard" }, { id: "beacon", name: "Beacon" }],
  products: [{ code: "final_expense", name: "Final Expense" }],
  tenantCarriers: [contract("cardinal"), contract("mutual")],
  commissionSchedules: [],
  advanceRules: [{ id: "r1", carrier_id: "cardinal", product_code: "final_expense", advance_months: 9, advance_pct_bp: 7500, clawback_months: 12, clawback_type: "prorated", effective_from: "2026-01-01" }],
  carrierRequirements,
  requirementsAvailable: true,
});

test("no requirement row, or contracted = true, reads as switched on", () => {
  assert.equal(carrierSwitchedOn(library([]), "cardinal"), true);
  assert.equal(carrierSwitchedOn(library([{ carrier_id: "cardinal" }]), "cardinal"), true);
  assert.equal(carrierSwitchedOn(library([{ carrier_id: "cardinal", contracted: true }]), "cardinal"), true);
  assert.equal(carrierSwitchedOn(library([{ carrier_id: "cardinal", contracted: false }]), "cardinal"), false);
});

test("a switched-off carrier leaves the summary counts, but keeps its contract row", () => {
  const on = library([{ carrier_id: "cardinal" }, { carrier_id: "mutual" }]);
  assert.equal(summarizeLibrary(on).activeCarriers, 2);
  assert.equal(summarizeLibrary(on).productContracts, 1);

  const off = library([{ carrier_id: "cardinal", contracted: false }, { carrier_id: "mutual", contracted: true }]);
  const summary = summarizeLibrary(off);
  assert.equal(summary.activeCarriers, 1);
  assert.equal(summary.libraryCarriers, 3);
  assert.equal(summary.productContracts, 0);
  assert.equal(summary.contractCarriers, 0);
  assert.deepEqual(summary.carriersWithoutAdvanceRule, [{ carrierId: "mutual", carrierName: "Mutual Standard" }]);
  // The edit dialog still finds the contract row of a switched-off carrier.
  assert.equal(activeContract(off.tenantCarriers, "cardinal")?.id, "tc-cardinal");
});
