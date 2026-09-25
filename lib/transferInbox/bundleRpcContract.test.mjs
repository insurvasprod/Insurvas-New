import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LA-1.10 inbox bundle RPC preserves the two reads and service-only access", async () => {
  const migration = await readFile("supabase/migrations/20260915120000_la_1_10_inbox_bundle_empty_handoff_fast_path.sql", "utf8");
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.list_transfer_inbox_bundle/i);
  assert.match(migration, /public\.list_transfer_inbox\s*\(/i);
  assert.match(migration, /public\.list_buffer_handoffs\s*\(/i);
  assert.match(migration, /exists\s*\(\s*select\s+1\s+from\s+public\.buffer_handoffs/i);
  assert.match(migration, /status\s*=\s*'pending'/i);
  assert.match(migration, /jsonb_build_object\s*\(\s*'items'\s*,\s*v_items\s*,\s*'handoffs'\s*,\s*v_handoffs\s*\)/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.list_transfer_inbox_bundle/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.list_transfer_inbox_bundle[\s\S]*to\s+service_role/i);
  assert.doesNotMatch(migration, /drop\s+table|delete\s+from|truncate\s+table/i);
});
