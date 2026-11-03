import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260913160000_la_1_21_22_tenant_notes_callbacks.sql", import.meta.url),
  "utf8",
);

test("LA-1.21/22 legacy collision guard is data-independent", () => {
  assert.match(migration, /information_schema\.columns[\s\S]*column_name = 'organization_id'/i);
  assert.match(migration, /callbacks_audit_write/);
  assert.doesNotMatch(migration, /count\(\*\) from public\.lead_notes/);
  assert.doesNotMatch(migration, /expected the 2 that were there before/);
});
