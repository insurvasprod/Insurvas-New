// LA-0 database defense-in-depth check. The tenant connection is deliberately used here rather
// than the service client: service_role bypasses RLS and would make this test meaningless.
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const tenantUrl = process.env.TENANT_DB_URL;
if (!tenantUrl) throw new Error("TENANT_DB_URL is required for the LA-0 RLS check");

const tables = [
  "tenant_carriers", "commission_schedules", "advance_rules", "appointments", "licenses",
  "eo_policies", "ce_records", "households", "contacts", "contact_phones", "contact_emails",
  "field_schema", "merge_log",
];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) process.exitCode = 1;
};

const [{ data: tenantRows, error: tenantError }, { data: allTenants, error: allTenantsError }] = await Promise.all([
  service.from("contacts").select("tenant_id").limit(100),
  service.from("tenants").select("id").limit(100),
]);
if (tenantError || allTenantsError || !tenantRows?.length || !allTenants?.length) {
  throw new Error(tenantError?.message ?? allTenantsError?.message ?? "Need live tenant fixtures");
}
const tenantWithData = tenantRows[0].tenant_id;
const differentTenant = allTenants.find((row) => row.id !== tenantWithData)?.id;
if (!differentTenant) throw new Error("Need two different tenant fixtures for the isolation check");
const tenantIds = [tenantWithData, differentTenant];
const connection = new pg.Client({ connectionString: tenantUrl, ssl: { rejectUnauthorized: false } });
await connection.connect();

try {
  for (const tenantId of tenantIds) {
    await connection.query("begin");
    await connection.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const table of tables) {
      const result = await connection.query(`select tenant_id from public.${table}`);
      check(`${table} exposes only tenant ${tenantId}`, result.rows.every((row) => row.tenant_id === tenantId), `${result.rows.length} rows returned`);
    }
    const carriers = await connection.query("select is_active from public.carriers");
    check(`carriers exposes only active reference rows`, carriers.rows.every((row) => row.is_active === true), `${carriers.rows.length} rows returned`);
    await connection.query("rollback");
  }
} finally {
  await connection.end();
}

if (process.exitCode) process.exit(1);
console.log(`All LA-0 tenant RLS checks passed for ${tenantIds.length} tenant session(s).`);
