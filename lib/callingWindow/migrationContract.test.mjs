import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20260913310000_la_2_4_calling_windows.sql", "utf8");

test("LA-2.4 migration does not false-fail when RLS hides all tenant rows", () => {
  assert.match(migration, /v_tenant_id uuid/);
  assert.match(migration, /select id into v_tenant_id\s+from public\.tenants/);
  assert.match(migration, /if v_tenant_id is not null then/);
  assert.match(migration, /values \(v_tenant_id, 20, 9\)/);
  assert.doesNotMatch(migration, /insert into public\.tenant_calling_windows \(tenant_id, start_hour, end_hour\)\s+select id, 20, 9 from public\.tenants/);
});
