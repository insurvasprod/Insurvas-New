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

// ---------------------------------------------------------------------------
// LA-0.4 criterion 2, guarded rather than asserted
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

test("the ledger cannot produce a commission figure without the schedule", () => {
  // LA-0.4 criterion 2: "A commission figure anywhere in the product traces back to this table,
  // never a hardcoded percentage."
  //
  // On 2026-09-22 that criterion is **vacuously true**: there is no commission figure anywhere to
  // trace. `commissionCentsFromSchedule` and `resolveCommissionRate` have no callers, `policies`
  // stores `annual_premium_cents` and no commission column, and no commission-entries table
  // exists. The library was built first on purpose — the ticket's own argument is that building it
  // after the features that read it means retrofitting "the most load-bearing table in the
  // product".
  //
  // A criterion that is true because nothing exercises it is worth exactly nothing later, so this
  // pins it: the ledger is where the first commission figure will surface, and when it does it has
  // to come from the schedule rather than a literal.
  const route = join(process.cwd(), "app", "api", "app", "ledger", "route.ts");
  if (!existsSync(route)) return;
  const source = readFileSync(route, "utf8");

  if (/entries:\s*\[\s*\]/.test(source)) return; // still the frame; nothing to derive yet

  // The route delegates to lib/ledger (service → compute). Follow it: the derivation is what must
  // call the schedule, not the comment in the route that says so.
  const derivation = /@\/lib\/ledger\/service/.test(source)
    ? readFileSync(join(process.cwd(), "lib", "ledger", "compute.ts"), "utf8")
    : source;
  assert.ok(
    /commissionCentsFromSchedule\(/.test(derivation) && /resolveCommissionRate\(/.test(derivation),
    "app/api/app/ledger/route.ts returns ledger rows without deriving them from the commission " +
      "schedule — LA-0.4 criterion 2 requires every commission figure to trace back to that table, " +
      "never a hardcoded percentage",
  );
});

test("an open-ended row covers later years that have no row of their own", () => {
  const base = { tenant_id: "a", carrier_id: "carrier", product_code: "final_expense", contract_level_bp: 11000, effective_from: "2026-01-01", created_at: "2026-01-01" };
  const rows = [
    { ...base, id: "y10", policy_year: 10, rate_bp: 300 },
    { ...base, id: "y11", policy_year: 11, rate_bp: 100, applies_onward: true },
    { ...base, id: "y20", policy_year: 20, rate_bp: 50 },
  ];
  const at = (policyYear) => resolveCommissionRate(rows, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear, asOf: "2026-08-01" })?.id ?? null;
  assert.equal(at(10), "y10");
  assert.equal(at(11), "y11");
  assert.equal(at(15), "y11");
  assert.equal(at(20), "y20", "an exact year beats the open-ended row");
  assert.equal(at(9), null, "an open-ended row never reaches backwards");
  const closed = rows.map((row) => ({ ...row, applies_onward: false }));
  assert.equal(resolveCommissionRate(closed, { carrierId: "carrier", productCode: "final_expense", contractLevelBp: 11000, policyYear: 15, asOf: "2026-08-01" }), null);
});
