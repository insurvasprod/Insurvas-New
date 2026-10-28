// Carrier fact reports (20261027200000): the agency's "Tell us" saves a report; staff close it in the
// admin console. These pin the guarantees the feature rests on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261027200000_carrier_fact_reports.sql");
const store = read("lib/carriers/factReports.ts");

test("the table is tenant-scoped, read-only to tenant connections, and never deleted", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select to tenant_app\s+using \(tenant_id = nullif\(\(select current_setting\('app\.tenant_id', true\)\), ''\)::uuid\)/);
  assert.match(migration, /revoke insert, update on public\.carrier_fact_reports from tenant_app/);
  assert.match(migration, /revoke delete, truncate on public\.carrier_fact_reports from service_role, tenant_app/);
  assert.match(migration, /carrier_fact_reports_resolved_when_closed check \(\(status = 'open'\) = \(resolved_at is null\)\)/);
  assert.match(migration, /carrier_fact_reports_declined_says_why/);
  assert.match(migration, /organization_id is null/, "a report names a platform carrier only");
});

test("every agency read and write of reports is filtered by its tenant", () => {
  const agency = store.slice(store.indexOf("export async function createFactReport"), store.indexOf("/* ── the staff side"));
  const reads = (agency.match(/from\("carrier_fact_reports"\)[^\n]*/g) ?? []).filter((line) => line.includes(".select("));
  assert.ok(reads.length >= 2);
  for (const line of reads) assert.match(line, /\.eq\("tenant_id", tenantId\)/, line);
  assert.match(agency, /from\("carrier_fact_reports"\)\.insert\(\{\s*tenant_id: tenantId,/, "a report is written for the caller's tenant");
});

test("a fix writes only the platform carrier, and closing is first-wins", () => {
  const resolve = store.slice(store.indexOf("export async function resolveFactReport"));
  assert.match(resolve, /from\("carriers"\)\.update\(\{ \[column\]: next\.value \}\)\.eq\("id", row\.carrier_id\)\.is\("organization_id", null\)/);
  assert.match(resolve, /\.eq\("id", id\)\.eq\("status", "open"\)/);
  assert.match(resolve, /Say why, so the agency knows/);
});

test("staff routes need carrier-library access, and the agency route is owner-only", () => {
  for (const path of ["app/api/admin/carrier-fact-reports/route.ts", "app/api/admin/carrier-fact-reports/[id]/route.ts"]) {
    assert.match(read(path), /requireAdminRole\(\["super_admin", "platform_config"\]\)/, path);
  }
  const agency = read("app/api/app/carrier-fact-reports/route.ts");
  assert.match(agency, /requireFeatureRole\("appointment_vault", \["owner"\], \{ write: true \}\)/);
  assert.match(read("app/admin/(protected)/carrier-reports/page.tsx"), /canAccessConfigurationSection\(admin\.role, "carriers"\)/);
});

test("carrier setup no longer exposes the removed portal-login and carrier-facts panels", () => {
  const card = read("components/app/settings/carrier-card.tsx");
  assert.doesNotMatch(card, /Your portal login|function PortalSection|function TellUs|carrier facts/i);
  assert.match(card, /function ProductsSection/);
});
