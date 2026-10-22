// AG-0.9 · producer contract levels and writing numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bpsToPercent, percentToBps } from "./constants.ts";
import { applyBps, computeOverride, levelAsOf } from "./overrideCore.ts";
import { producerCarrierSchema } from "./schemas.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018155000_ag_0_9_contract_levels_and_writing_numbers.sql", import.meta.url), "utf8");

test("a level change in June leaves a May policy's expected commission unchanged", () => {
  const levels = [
    { carrierId: "americo", levelBps: 8500, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" },
    { carrierId: "americo", levelBps: 9000, effectiveFrom: "2026-06-01", effectiveTo: null },
  ];
  assert.equal(applyBps(120_000, levelAsOf(levels, "americo", "2026-05-20")), 102_000);
  assert.equal(applyBps(120_000, levelAsOf(levels, "americo", "2026-06-20")), 108_000);
  // and the writer closes the row in force instead of editing it
  assert.match(sql, /update public\.producer_contract_level set effective_to = p_effective_from - 1/);
});

test("a duplicate writing number within one carrier is refused by the database", () => {
  assert.match(sql, /constraint producer_writing_number_one_owner exclude using gist \(\s*tenant_id with =, carrier_id with =, writing_number with =/);
  assert.match(sql, /constraint producer_writing_number_unique_start unique \(tenant_id, carrier_id, writing_number, effective_from\)/);
});

test("no level for a carrier: expected commission is null, not zero, and never the agency's level", () => {
  const result = computeOverride({ annualPremiumCents: 120_000, agencyLevelBps: 11000, producerLevelBps: levelAsOf([], "aflac", "2026-10-18") });
  assert.equal(result.producerPoolCents, null);
  assert.equal(result.overrideCents, null);
  assert.equal(result.flag, "producer_level_missing");
});

test("levels are integer basis points, typed as percentages without a float", () => {
  assert.equal(percentToBps("90"), 9000);
  assert.equal(percentToBps("85.5"), 8550);
  assert.equal(percentToBps("120.25"), 12025);
  assert.equal(percentToBps("85.555"), null);
  assert.equal(percentToBps("abc"), null);
  assert.equal(bpsToPercent(8550), "85.5%");
  assert.equal(bpsToPercent(null), "—");
  assert.equal(producerCarrierSchema.safeParse({ carrierId: "00000000-0000-4000-8000-000000000000", effectiveFrom: "2026-10-18" }).success, false);
});

test("the per-product gap is named on the table, and numbers feed LA-4's attribution map", () => {
  assert.match(sql, /comment on table public\.producer_contract_level is\s*'AG-0\.9\. One level per producer per CARRIER, not per carrier and product\. Known gap/);
  assert.match(sql, /insert into public\.carrier_agent_map/);
});
