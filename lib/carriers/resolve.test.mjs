import test from "node:test";
import assert from "node:assert/strict";
import { commissionCentsFromSchedule, resolveCommissionRate } from "./resolve.ts";

const row = (tenant_id, rate_bp, effective_from) => ({ id: `${tenant_id}-${rate_bp}-${effective_from}`, tenant_id, carrier_id: "carrier", product_code: "final_expense", contract_level_bp: tenant_id === "a" ? 11000 : 11500, policy_year: 1, rate_bp, effective_from, created_at: effective_from });

test("commission resolution is effective-dated and tenant/level specific", () => {
  const rows = [row("a", 10000, "2026-01-01"), row("a", 11000, "2026-07-01"), row("b", 11500, "2026-01-01")];
  assert.equal(resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear: 1, asOf: "2026-06-30" }).rate_bp, 10000);
  assert.equal(resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear: 1, asOf: "2026-08-01" }).rate_bp, 11000);
  assert.equal(resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11500, policyYear: 1, asOf: "2026-08-01" }).rate_bp, 11500);
});

test("commission resolution does not invent a rate", () => {
  assert.equal(resolveCommissionRate([], { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear: 1, asOf: "2026-08-01" }), null);
});

test("resolved rates calculate integer cents for agents at different levels", () => {
  const rows = [row("a", 10000, "2026-01-01"), row("b", 11500, "2026-01-01")];
  const levelA = resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear: 1, asOf: "2026-08-01" });
  const levelB = resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11500, policyYear: 1, asOf: "2026-08-01" });
  assert.ok(levelA && levelB);
  assert.equal(commissionCentsFromSchedule(6000, levelA), 6000);
  assert.equal(commissionCentsFromSchedule(6000, levelB), 6900);
});
