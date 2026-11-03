// AG-0.8 · solo agent to agency upgrade — the backfill migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyBps, levelAsOf } from "./overrideCore.ts";

const sql = readFileSync(new URL("../../supabase/migrations/20261018160000_ag_0_8_solo_to_agency_backfill.sql", import.meta.url), "utf8");

test("a second run is a no-op: every step fills only what is missing", () => {
  assert.match(sql, /on conflict \(tenant_id\) do nothing/);
  assert.match(sql, /on conflict on constraint producer_one_per_member do nothing/);
  assert.match(sql, /on conflict on constraint producer_contract_level_unique_start do nothing/);
  assert.match(sql, /on conflict \(tenant_id, carrier_id, agent_identifier\) do nothing/);
  for (const update of sql.match(/^\s*update public\.\w+ set [^;]+;/gm) ?? []) {
    assert.match(update, /is null/, `an update that could overwrite: ${update.trim()}`);
  }
});

test("one transaction, and nothing left unattributed", () => {
  assert.match(sql, /agency_upgrade_left_nulls/);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test("the immutable ledgers stay immutable to the app: one flagged, empty-only exception in the guard", () => {
  assert.doesNotMatch(sql, /grant (update|insert)[^;]*commission_entry/i);
  assert.match(sql, /current_setting\('app\.agency_backfill_tenant', true\) = old\.tenant_id::text/);
  assert.match(sql, /old\.agent_user_id is null and \(old\.agency_id is null or old\.agency_id = new\.agency_id\)/);
  assert.match(sql, /'A commission entry is never changed or removed; write a reversal instead\.'/);
});

test("contract levels keep the effective_from they already had — expected commission before = after", () => {
  // before: the solo agent's LA-0.4 rows (tenant_carriers), each running until the next one starts
  const tenantCarriers = [
    { carrierId: "americo", levelBps: 11000, effectiveFrom: "2025-01-01", effectiveTo: "2026-05-31" },
    { carrierId: "americo", levelBps: 12000, effectiveFrom: "2026-06-01", effectiveTo: null },
  ];
  // after: the same rows copied into producer_contract_level with the same dates (never "today")
  assert.match(sql, /lead\(tc\.effective_from\) over \(partition by tc\.carrier_id order by tc\.effective_from\) - 1/);
  assert.match(sql, /values \(p_tenant_id, v_agency, v_producer, v_tc\.carrier_id, v_tc\.contract_level_bp, v_tc\.effective_from, v_tc\.effective_to, p_actor\)/);
  const producerLevels = tenantCarriers.map((r) => ({ ...r }));
  for (const asOf of ["2025-03-01", "2026-05-15", "2026-10-18"]) {
    const before = applyBps(120_000, levelAsOf(tenantCarriers, "americo", asOf));
    const after = applyBps(120_000, levelAsOf(producerLevels, "americo", asOf));
    assert.equal(after, before, asOf);
  }
});

test("unclaimed leads stay in the pool to be routed; worked leads become the owner's", () => {
  assert.match(sql, /owner_user_id is null and status <> 'unclaimed'/);
});
