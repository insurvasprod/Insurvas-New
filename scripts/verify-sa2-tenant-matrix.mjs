import "./lib/refuseProduction.mjs";
// SA-2.8 tenant boundary check.
// The SA-2 control-plane tables are deliberately service-role-only. Tenant users consume their
// own entitlement through server adapters, never by directly querying subscriptions or billing
// tables. This verifier proves all four direct Postgres operations are denied for two authenticated
// tenant_app sessions and that the application session still resolves only its own tenant.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const tenantUrl = process.env.TENANT_DB_URL;
if (!tenantUrl) throw new Error("TENANT_DB_URL is required for the SA-2 tenant matrix");

const CONTROL_TABLES = [
  "subscriptions",
  "subscription_addons",
  "tenant_entitlements",
  "usage_events",
  "usage_totals",
  "subscription_mutation_requests",
];
const ACTIONS = ["select", "insert", "update", "delete"];
let failures = 0;
const check = (label, condition, detail = "") => {
  console.log(condition ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
};

const stamp = Date.now();
const tenants = [];
const users = [];
const db = new pg.Pool({ connectionString: tenantUrl, ssl: { rejectUnauthorized: false } });

async function provision(label) {
  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .insert({ name: `SA28 matrix ${label} ${stamp}`, status: "active" })
    .select("id")
    .single();
  if (tenantError || !tenant) throw new Error(`Could not create tenant ${label}: ${tenantError?.message ?? "missing"}`);
  const fixture = await createFixtureUser(service, {
    email: `sa28-matrix-${label}-${stamp}@invalid.test`,
    name: `SA28 matrix ${label}`,
    password: `SA28Matrix-${label}-${stamp}!`,
  });
  const { error: membershipError } = await service.from("tenant_users").insert({
    tenant_id: tenant.id,
    user_id: fixture.userId,
    role: "owner",
    accepted_at: new Date().toISOString(),
  });
  if (membershipError) throw new Error(`Could not create ${label} membership: ${membershipError.message}`);
  tenants.push(tenant.id);
  users.push(fixture.userId);
  return { tenantId: tenant.id, userId: fixture.userId, password: `SA28Matrix-${label}-${stamp}!`, label };
}

async function directOperation(tenantId, table, action) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const sql = {
      select: `select * from public.${table} limit 1`,
      insert: `insert into public.${table} default values`,
      update: {
        subscriptions: "update public.subscriptions set plan_id = plan_id where false",
        subscription_addons: "update public.subscription_addons set addon_id = addon_id where false",
        tenant_entitlements: "update public.tenant_entitlements set tenant_id = tenant_id where false",
        usage_events: "update public.usage_events set qty = qty where false",
        usage_totals: "update public.usage_totals set used_qty = used_qty where false",
        subscription_mutation_requests: "update public.subscription_mutation_requests set status = status where false",
      }[table],
      delete: `delete from public.${table} where false`,
    }[action];
    const result = await client.query(sql);
    await client.query("rollback");
    return { denied: false, rows: result.rows };
  } catch (error) {
    await client.query("rollback");
    return { denied: /permission denied|violates row-level security policy/i.test(error.message ?? ""), message: error.message };
  } finally {
    client.release();
  }
}

async function login(fixture) {
  const response = await fetch(`${BASE}/api/app/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `sa28-matrix-${fixture.label}-${stamp}@invalid.test`, password: fixture.password }),
  });
  return { response, cookie: response.headers.get("set-cookie") };
}

async function cleanup() {
  await service.from("tenant_entitlements").delete().in("tenant_id", tenants);
  await service.from("subscriptions").delete().in("tenant_id", tenants);
  await service.from("tenant_users").delete().in("tenant_id", tenants);
  for (const userId of users) await deleteFixtureUser(service, userId);
  await service.from("tenants").delete().in("id", tenants);
  await db.end();
}

const a = await provision("a");
const b = await provision("b");
const { error: entitlementError } = await service.from("tenant_entitlements").insert([
  { tenant_id: a.tenantId, entitlement: { tenant_id: a.tenantId, plan_code: "matrix", plan_version: 1, status: "active", access: "full", features: [], meters: {}, limits: {} } },
  { tenant_id: b.tenantId, entitlement: { tenant_id: b.tenantId, plan_code: "matrix", plan_version: 1, status: "active", access: "full", features: [], meters: {}, limits: {} } },
]);
if (entitlementError) throw new Error(`Could not seed entitlement fixtures: ${entitlementError.message}`);

try {
  console.log("Direct tenant_app control-plane matrix\n");
  for (const fixture of [a, b]) {
    for (const table of CONTROL_TABLES) {
      for (const action of ACTIONS) {
        const outcome = await directOperation(fixture.tenantId, table, action);
        const entitlementRead = table === "tenant_entitlements" && action === "select";
        const allowedOnlyForOwnTenant = entitlementRead && !outcome.denied && outcome.rows?.every((row) => row.tenant_id === fixture.tenantId);
        check(
          entitlementRead
            ? `${fixture.label} SELECT tenant_entitlements is scoped to its own tenant`
            : `${fixture.label} ${action.toUpperCase()} ${table} is denied`,
          entitlementRead ? allowedOnlyForOwnTenant : outcome.denied,
          outcome.message ?? (entitlementRead ? `rows ${JSON.stringify(outcome.rows ?? [])}` : "operation unexpectedly succeeded"),
        );
      }
    }
  }

  console.log("\nAuthenticated application scope\n");
  for (const fixture of [a, b]) {
    const loginResult = await login(fixture);
    const me = loginResult.cookie
      ? await fetch(`${BASE}/api/app/me`, { headers: { cookie: loginResult.cookie } })
      : null;
    const meBody = me ? await me.json() : null;
    check(`${fixture.label} login resolves its own tenant`, loginResult.response.ok && me?.ok && meBody?.tenant?.id === fixture.tenantId, `login ${loginResult.response.status}, me ${me?.status ?? "no cookie"}`);

    const adminRoute = loginResult.cookie
      ? await fetch(`${BASE}/api/admin/subscriptions`, { headers: { cookie: loginResult.cookie } })
      : null;
    check(`${fixture.label} tenant session cannot use admin subscription API`, adminRoute?.status === 401, `HTTP ${adminRoute?.status ?? "no cookie"}`);
  }
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nAll SA-2 tenant matrix checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
