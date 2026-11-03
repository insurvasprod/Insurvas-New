import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260913150000_la_1_20_timeline_append_only.sql", import.meta.url),
  "utf8",
);

test("LA-1.20 validates service-role timeline grants through privilege functions", () => {
  assert.match(migration, /revoke update, truncate on public\.verification_field_changes from service_role/i);
  assert.match(migration, /revoke update, truncate on public\.callback_history from service_role/i);
  assert.match(migration, /has_table_privilege\('service_role',\s*format\('public\.%I'/i);
  assert.match(migration, /has_table_privilege\('service_role',\s*'public\.audit_log',\s*'INSERT'/i);
  assert.match(migration, /has_table_privilege\('service_role',\s*'public\.verification_field_changes',\s*'SELECT'/i);
  assert.doesNotMatch(migration, /information_schema\.role_table_grants/i);
});
