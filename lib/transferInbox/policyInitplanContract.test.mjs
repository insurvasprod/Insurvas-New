import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LA-1 tenant compatibility policies evaluate app settings through initplans", async () => {
  const migration = await readFile("supabase/migrations/20260915080043_la_1_tenant_policy_initplans.sql", "utf8");

  for (const policy of ["agent_leads_tenant_compat", "lead_queue_tenant_compat"]) {
    assert.match(migration, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${policy}`, "i"));
    assert.match(migration, new RegExp(`create\\s+policy\\s+${policy}`, "i"));
  }

  assert.equal((migration.match(/current_setting\('app\.tenant_id', true\)/gi) ?? []).length, 4);
  assert.doesNotMatch(migration, /grant\\s+(?!execute)/i);
  assert.doesNotMatch(migration, /delete\\s+from|truncate\\s+table|drop\\s+table/i);
});
