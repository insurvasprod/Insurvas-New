import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260902190000_la_1_9_pipelines.sql", import.meta.url),
  "utf8",
);

test("LA-1.9 skips the UUID seed when a CRM bigint pipeline table owns the legacy name", () => {
  assert.match(migration, /format_type\(a\.atttypid, a\.atttypmod\) = 'uuid'/g);
  assert.match(migration, /insert into public\.stage_dispositions[\s\S]*on conflict \(tenant_id, disposition_key\) do nothing/i);
  assert.match(migration, /organizations-era[\s\S]*bigint/i);
});
