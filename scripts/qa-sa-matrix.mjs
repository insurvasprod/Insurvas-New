/**
 * SA QA matrix: every admin surface, probed as every admin role, read-only.
 *
 * Run with: npm run qa:sa-matrix -- --out <file.json>
 *
 * The probes themselves are GET-only. If a required admin role is absent, this script creates a
 * clearly namespaced verification-only admin row, signs a local session for the matrix, and
 * deactivates that row in finally; it never sends email or changes business data. This keeps the
 * matrix fail-closed without requiring a real password-based login for every support role.
 *
 * A 500 here almost always means the route reached the database and the table it wanted is not
 * there. That distinction — refused (401/403) versus broken (5xx) — is the whole point.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

const ADMIN_ROLES = ["super_admin", "support_agent", "billing_admin", "platform_config"];
const TENANT_ROLES = ["owner", "assistant"]; // owner + a deliberately restricted member
const stamp = Date.now();
const temporaryAdmins = [];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sign = (secret, claims) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(secret));

async function adminCookie(role) {
  const { data, error: readError } = await sb
    .from("admin_users")
    .select("id, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`cannot read admin_users for ${role}: ${readError.message}`);

  let admin = data;
  if (!admin) {
    const { data: created, error: createError } = await sb
      .from("admin_users")
      .insert({
        email: `qa-sa-matrix-${role}-${stamp}@insurvas.invalid`,
        name: `QA matrix ${role}`,
        role,
        password_hash: "verification-only",
        totp_secret: "verification-only",
        is_active: true,
      })
      .select("id, role")
      .single();
    if (createError) throw new Error(`cannot create temporary ${role} admin: ${createError.message}`);
    admin = created;
    temporaryAdmins.push(created.id);
  }

  const token = await sign(process.env.ADMIN_SESSION_SECRET, {
    sub: admin.id,
    role: admin.role,
    stage: "authenticated",
  });
  return { role, cookie: `insurvas_admin_session=${token}` };
}

async function deactivateTemporaryAdmins() {
  if (!temporaryAdmins.length) return;
  const { error } = await sb.from("admin_users").update({ is_active: false }).in("id", temporaryAdmins);
  if (error) throw new Error(`cannot deactivate temporary admin fixtures: ${error.message}`);
  console.log(`temporary admin fixtures deactivated: ${temporaryAdmins.length}`);
}

async function tenantCookie(role) {
  const { data } = await sb
    .from("tenant_users")
    .select("user_id, tenant_id, role")
    .eq("role", role)
    .limit(1)
    .maybeSingle();
  if (!data) return { role, cookie: null, reason: `no tenant_users row with role ${role}` };
  const { data: user } = await sb.from("users").select("session_version").eq("id", data.user_id).maybeSingle();
  const token = await sign(process.env.TENANT_SESSION_SECRET, {
    sub: data.user_id,
    tenantId: data.tenant_id,
    sessionVersion: user?.session_version ?? 0,
  });
  return { role, cookie: `insurvas_tenant_session=${token}` };
}

/** Static API routes only: a dynamic segment needs a real id, which a read-only probe cannot invent. */
function routes(root, prefix) {
  const out = { static: [], dynamic: [] };
  const walk = (dir, url) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${url}/${entry.name}`);
      else if (entry.name === "route.ts") (url.includes("[") ? out.dynamic : out.static).push(url);
    }
  };
  walk(root, prefix);
  out.static.sort();
  out.dynamic.sort();
  return out;
}

function screens(root, prefix) {
  const out = [];
  const walk = (dir, url) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Route groups like (protected) do not appear in the URL.
        walk(path, entry.name.startsWith("(") ? url : `${url}/${entry.name}`);
      } else if (entry.name === "page.tsx" && !url.includes("[")) out.push(url || "/");
    }
  };
  walk(root, prefix);
  return [...new Set(out)].sort();
}

async function probe(path, cookie) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return response.status;
  } catch (error) {
    return `ERR ${error.message.slice(0, 40)}`;
  }
}

const adminApi = routes(join(process.cwd(), "app", "api", "admin"), "/api/admin");
const adminScreens = screens(join(process.cwd(), "app", "admin"), "/admin");

try {
const sessions = [];
for (const role of ADMIN_ROLES) sessions.push(await adminCookie(role));
for (const role of TENANT_ROLES) sessions.push(await tenantCookie(role));

const report = {
  base: BASE,
  collected_at: new Date().toISOString(),
  sessions: sessions.map((s) => ({ role: s.role, available: Boolean(s.cookie), reason: s.reason ?? null })),
  api: {},
  screens: {},
  counts: { static_api: adminApi.static.length, dynamic_api_skipped: adminApi.dynamic.length, screens: adminScreens.length },
  dynamic_api_skipped: adminApi.dynamic,
};

for (const path of adminApi.static) {
  const statuses = await Promise.all([
    probe(path, null),
    ...sessions.map((s) => (s.cookie ? probe(path, s.cookie) : Promise.resolve("no-session"))),
  ]);
  report.api[path] = Object.fromEntries(["anonymous", ...sessions.map((s) => s.role)].map((role, index) => [role, statuses[index]]));
}

for (const path of adminScreens) {
  const statuses = await Promise.all([
    probe(path, null),
    ...sessions.map((s) => (s.cookie ? probe(path, s.cookie) : Promise.resolve("no-session"))),
  ]);
  report.screens[path] = Object.fromEntries(["anonymous", ...sessions.map((s) => s.role)].map((role, index) => [role, statuses[index]]));
}

// A quick roll-up, because 100 rows of status codes is not a finding.
const flatten = (group) => Object.entries(group).flatMap(([path, row]) => Object.entries(row).map(([role, status]) => ({ path, role, status })));
const all = [...flatten(report.api), ...flatten(report.screens)];
const PUBLIC_ADMIN_PATHS = new Set(["/admin/login"]);
report.summary = {
  server_errors: all.filter((r) => typeof r.status === "number" && r.status >= 500),
  anonymous_leaks: all.filter((r) => r.role === "anonymous" && r.status === 200 && !PUBLIC_ADMIN_PATHS.has(r.path)),
  transport_errors: all.filter((r) => typeof r.status === "string" && r.status.startsWith("ERR ")),
  missing_sessions: report.sessions.filter((s) => !s.available),
  public_paths: [...PUBLIC_ADMIN_PATHS],
  ok_counts: Object.fromEntries(
    ["anonymous", ...ADMIN_ROLES, ...TENANT_ROLES].map((role) => [
      role,
      all.filter((r) => r.role === role && r.status === 200).length,
    ]),
  ),
};

const json = JSON.stringify(report, null, 2);
if (outPath) {
  mkdirSync(join(process.cwd(), outPath, ".."), { recursive: true });
  writeFileSync(outPath, json);
  console.log(`Wrote ${outPath}`);
} else {
  console.log(json);
}

console.log(`\nsessions: ${report.sessions.map((s) => `${s.role}=${s.available ? "ok" : "MISSING"}`).join("  ")}`);
console.log(`probed: ${adminApi.static.length} API routes + ${adminScreens.length} screens (${adminApi.dynamic.length} dynamic API routes skipped)`);
console.log(`200s by role: ${JSON.stringify(report.summary.ok_counts)}`);
console.log(`server errors (5xx): ${report.summary.server_errors.length}`);
console.log(`transport errors: ${report.summary.transport_errors.length}`);
console.log(`missing required sessions: ${report.summary.missing_sessions.length}`);
console.log(`anonymous 200s (should be 0 on protected paths): ${report.summary.anonymous_leaks.length}`);

// A matrix that cannot reach the local app or cannot obtain one of its required role sessions is
// not evidence of a healthy boundary. Fail closed so CI and the QA ledger cannot record a false
// green result from an all-ERR or partially exercised run.
if (report.summary.transport_errors.length > 0 || report.summary.missing_sessions.length > 0) {
  process.exitCode = 1;
}
} finally {
  try {
    await deactivateTemporaryAdmins();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
