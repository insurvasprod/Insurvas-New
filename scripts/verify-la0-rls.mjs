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

// rows.every() is true for an empty result, so every assertion below passes when the connection
// returns nothing at all -- a broken fixture would read as perfect isolation. An empty result IS a
// legitimate outcome per table (the tenant may own no rows there), so the guard belongs at the run
// level: the tenant that is supposed to have data must actually have been seen to have some.
let rowsSeenForTenantWithData = 0;

try {
  for (const tenantId of tenantIds) {
    await connection.query("begin");
    await connection.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const table of tables) {
      const result = await connection.query(`select tenant_id from public.${table}`);
      if (tenantId === tenantWithData) rowsSeenForTenantWithData += result.rows.length;
      check(`${table} exposes only tenant ${tenantId}`, result.rows.every((row) => row.tenant_id === tenantId), `${result.rows.length} rows returned`);
    }
    const carriers = await connection.query("select is_active from public.carriers");
    // Carriers are reference data and are never legitimately empty, so this one can require rows.
    check(`carriers exposes only active reference rows`, carriers.rows.length > 0 && carriers.rows.every((row) => row.is_active === true), `${carriers.rows.length} rows returned`);
    await connection.query("rollback");
  }
} finally {
  await connection.end();
}

check("the isolation check actually saw data", rowsSeenForTenantWithData > 0, `${rowsSeenForTenantWithData} rows visible to the tenant that owns data — zero means the assertions above proved nothing`);

if (process.exitCode) process.exit(1);
console.log(`All LA-0 tenant RLS checks passed for ${tenantIds.length} tenant session(s).`);
