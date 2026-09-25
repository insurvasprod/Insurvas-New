import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../../supabase/migrations/20260914130000_sa_0_4_harden_trigger_definers.sql", import.meta.url), "utf8");

test("SA-0.4 trigger definer hardening pins search_path and removes client execution", () => {
  for (const name of ["bump_contact_rate_stats", "carry_attribution_to_case", "carry_campaign_id_to_deal"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
  }
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated, tenant_app/);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/);
});
