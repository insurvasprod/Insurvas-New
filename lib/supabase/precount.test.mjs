import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(new URL("../../supabase/migrations/20261118100000_precounted_figures.sql", import.meta.url), "utf8");
const helper = fs.readFileSync(new URL("./precount.ts", import.meta.url), "utf8");

test("the app asks only for figures the database knows how to count", () => {
  const appKeys = [...helper.match(/export type PrecountKey = ([^;]+);/)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const sqlKeys = [...sql.matchAll(/p_key = '([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(appKeys, sqlKeys);
});

test("the kept figures are written only through their functions", () => {
  assert.match(sql, /revoke insert, update, delete, truncate on table public\.tenant_precount from service_role;/);
  assert.match(sql, /revoke all on table public\.tenant_precount from public, anon, authenticated, tenant_app;/);
  assert.match(sql, /alter table public\.tenant_precount enable row level security;/);
});

test("the refresh job is bounded and skips figures nobody opens", () => {
  assert.match(sql, /exit when clock_timestamp\(\) - v_job_started > interval '25 seconds'/);
  assert.match(sql, /t\.read_at > now\(\) - interval '1 day'/);
  assert.match(sql, /delete from public\.tenant_precount where read_at < now\(\) - interval '7 days'/);
});
