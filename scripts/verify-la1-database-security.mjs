import "./lib/refuseProduction.mjs";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.TENANT_DB_URL;
if (!databaseUrl) throw new Error("TENANT_DB_URL is required");

const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  const grants = await client.query(`
    select p.proname,
           coalesce(array_to_string(p.proconfig, ','), '') as config,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
           has_function_privilege('tenant_app', p.oid, 'EXECUTE') as tenant_app_execute,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('save_form_draft', 'broadcast_la_1_15_floor_change', 'render_disposition_note')
    order by p.proname
  `);

  check(grants.rowCount === 3, `all three hardened LA functions must exist (found ${grants.rowCount})`);
  for (const row of grants.rows) {
    check(row.anon_execute === false, `${row.proname} must deny anon execute`);
    check(row.authenticated_execute === false, `${row.proname} must deny authenticated execute`);
    check(row.tenant_app_execute === false, `${row.proname} must deny tenant_app execute`);
  }
  check(grants.rows.find((row) => row.proname === "save_form_draft")?.service_execute === true, "save_form_draft must be executable by service_role");
  check(/search_path=pg_catalog/.test(grants.rows.find((row) => row.proname === "render_disposition_note")?.config ?? ""), "render_disposition_note must pin search_path=pg_catalog");

  const policies = await client.query(`
    select policyname, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname = 'public'
      and policyname in ('partners_tenant_read', 'partner_terms_tenant_read', 'partner_users_tenant_read', 'affiliate_links_tenant_scoped')
    order by policyname
  `);
  check(policies.rowCount === 4, `all four tenant policies must exist (found ${policies.rowCount})`);
  for (const policy of policies.rows) {
    check(/SELECT current_setting/i.test(`${policy.qual} ${policy.with_check}`), `${policy.policyname} must initplan tenant context once`);
  }

  if (failures.length > 0) {
    console.error(`FAIL LA-1 database security (${failures.length} finding${failures.length === 1 ? "" : "s"})`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("PASS LA-1 database security grants and tenant policy initplans");
  }
} finally {
  await client.end().catch(() => undefined);
}
