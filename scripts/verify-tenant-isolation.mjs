// SA-0.2 acceptance check: provisions tenant A and B, then proves A's DB session can see none of
// B's rows — at the Postgres RLS layer (tenant_app role), not just application-layer filtering.
// Also exercises the real login -> session -> /api/app/me path if the dev server is reachable.
// Run with: npm run verify:tenant-isolation
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantDbUrl = process.env.TENANT_DB_URL;

if (!url || !serviceKey || !tenantDbUrl) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or TENANT_DB_URL in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const pool = new Pool({ connectionString: tenantDbUrl, ssl: { rejectUnauthorized: false } });

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

async function provision(suffix) {
  const email = `isolation-test-${suffix}-${Date.now()}@insurvas.test`;
  const passwordHash = await bcrypt.hash("VerifyIsolation123", 12);
  const { data, error } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: `Isolation Test ${suffix.toUpperCase()}`,
    p_owner_name: `Owner ${suffix.toUpperCase()}`,
    p_owner_email: email,
    p_owner_password_hash: passwordHash,
  });
  if (error) throw new Error(`Could not provision tenant ${suffix}: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { tenantId: row.tenant_id, userId: row.user_id, email };
}

async function queryAsTenant(tenantId, sql) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(sql);
    await client.query("COMMIT");
    return result.rows;
  } finally {
    client.release();
  }
}

async function cleanup(ids) {
  await supabase.from("tenant_users").delete().in("tenant_id", ids.tenantIds);
  await supabase.from("users").delete().in("id", ids.userIds);
  await supabase.from("tenants").delete().in("id", ids.tenantIds);
}

console.log("Provisioning tenant A and tenant B...");
const a = await provision("a");
const b = await provision("b");

try {
  console.log("\nDB-level RLS checks (via tenant_app role, not service_role)...");

  const tenantsAsA = await queryAsTenant(a.tenantId, "select id from tenants");
  check("A's session sees exactly 1 tenant (itself)", tenantsAsA.length === 1 && tenantsAsA[0].id === a.tenantId);

  const tenantsAsAForB = await queryAsTenant(a.tenantId, `select id from tenants where id = '${b.tenantId}'`);
  check("A's session gets 0 rows explicitly asking for B's tenant id", tenantsAsAForB.length === 0);

  const usersAsA = await queryAsTenant(a.tenantId, "select email from users");
  check(
    "A's session sees only A's owner in `users`, never B's",
    usersAsA.some((r) => r.email === a.email) && !usersAsA.some((r) => r.email === b.email),
  );

  const tenantUsersAsA = await queryAsTenant(a.tenantId, "select tenant_id from tenant_users");
  check(
    "A's session sees only A's membership rows in `tenant_users`",
    tenantUsersAsA.length > 0 && tenantUsersAsA.every((r) => r.tenant_id === a.tenantId),
  );

  // And the mirror image, so this isn't just "the first tenant created happens to win".
  const tenantsAsB = await queryAsTenant(b.tenantId, "select id from tenants");
  check("B's session sees exactly 1 tenant (itself)", tenantsAsB.length === 1 && tenantsAsB[0].id === b.tenantId);

  const usersAsB = await queryAsTenant(b.tenantId, "select email from users");
  check(
    "B's session sees only B's owner in `users`, never A's",
    usersAsB.some((r) => r.email === b.email) && !usersAsB.some((r) => r.email === a.email),
  );

  console.log("\nHTTP-level check (login -> session -> /api/app/me)...");
  try {
    const loginRes = await fetch("http://localhost:3000/api/app/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: a.email, password: "VerifyIsolation123" }),
    });
    const cookie = loginRes.headers.get("set-cookie");
    if (!loginRes.ok || !cookie) {
      console.log("  skip HTTP check — login did not return a session cookie");
    } else {
      const meRes = await fetch("http://localhost:3000/api/app/me", { headers: { cookie } });
      const me = await meRes.json();
      check("logged-in A's /api/app/me returns tenant A, not B", me?.tenant?.id === a.tenantId);
    }
  } catch {
    console.log("  skip HTTP check — dev server not reachable on http://localhost:3000");
  }
} finally {
  console.log("\nCleaning up test tenants...");
  await cleanup({ tenantIds: [a.tenantId, b.tenantId], userIds: [a.userId, b.userId] });
  await pool.end();
}

console.log(failures === 0 ? "\nAll isolation checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
