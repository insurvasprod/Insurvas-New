import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.TENANT_DB_URL;
if (!databaseUrl) throw new Error("TENANT_DB_URL is required");

const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

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

  assert.equal(grants.rowCount, 3, "all three hardened LA functions must exist");
  for (const row of grants.rows) {
    assert.equal(row.anon_execute, false, `${row.proname} must deny anon execute`);
    assert.equal(row.authenticated_execute, false, `${row.proname} must deny authenticated execute`);
    assert.equal(row.tenant_app_execute, false, `${row.proname} must deny tenant_app execute`);
  }
  assert.equal(grants.rows.find((row) => row.proname === "save_form_draft")?.service_execute, true);
  assert.match(grants.rows.find((row) => row.proname === "render_disposition_note")?.config ?? "", /search_path=pg_catalog/);

  const policies = await client.query(`
    select policyname, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
    where schemaname = 'public'
      and policyname in ('partners_tenant_read', 'partner_terms_tenant_read', 'partner_users_tenant_read', 'affiliate_links_tenant_scoped')
    order by policyname
  `);
  assert.equal(policies.rowCount, 4, "all four tenant policies must exist");
  for (const policy of policies.rows) {
    assert.match(`${policy.qual} ${policy.with_check}`, /SELECT current_setting/i, `${policy.policyname} must initplan tenant context once`);
  }

  console.log("PASS LA-1 database security grants and tenant policy initplans");
} finally {
  await client.end().catch(() => undefined);
}
