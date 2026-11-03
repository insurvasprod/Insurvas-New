import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LA-1.10 expiry sweep has a tenant-scoped pending partial index", async () => {
  const migration = await readFile("supabase/migrations/20260915100000_la_1_10_buffer_handoff_expiry_index.sql", "utf8");
  assert.match(migration, /create\s+index\s+if\s+not\s+exists\s+buffer_handoffs_expiry_sweep_idx/i);
  assert.match(migration, /on\s+public\.buffer_handoffs\s*\(\s*tenant_id\s*,\s*expires_at\s*\)/i);
  assert.match(migration, /where\s+status\s*=\s*'pending'/i);
  assert.doesNotMatch(migration, /drop\s+index|drop\s+table|delete\s+from/i);
});
