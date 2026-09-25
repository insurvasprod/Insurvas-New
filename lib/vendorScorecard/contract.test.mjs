import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20260913420000_la_2_17_live_vendor_scorecard.sql", root), "utf8");
const reportRoute = await readFile(new URL("app/api/app/true-cpa/route.ts", root), "utf8");
const leadsRoute = await readFile(new URL("app/api/app/true-cpa/leads/route.ts", root), "utf8");
const page = await readFile(new URL("app/app/(shell)/true-cpa/page.tsx", root), "utf8");

test("LA-2.17 is a live tenant-scoped report, not a nightly snapshot", () => {
  assert.match(migration, /create table if not exists public\.tenant_issued_policies/);
  assert.match(migration, /create or replace function public\.tenant_vendor_scorecard_report/);
  assert.match(migration, /contact_rate_by_slot/);
  assert.match(migration, /attempts_to_contact/);
  assert.match(migration, /'live', true, 'snapshot', false/);
  assert.match(migration, /using \(tenant_id = nullif\(\(select current_setting\('app\.tenant_id'/);
  assert.match(migration, /grant execute on function public\.tenant_vendor_scorecard_report[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /create table[^;]+snapshot/i);
});

test("LA-2.17 API and page use the entitlement and expose the drill-through", () => {
  assert.match(reportRoute, /requireFeatureRole\("true_cpa", \["owner", "producer", "bookkeeper"\]\)/);
  assert.match(leadsRoute, /requireFeatureRole\("true_cpa", \["owner", "producer", "bookkeeper"\]\)/);
  assert.match(page, /guardPage\("true_cpa"\)/);
  assert.match(page, /TrueCpaWorkspace/);
});
