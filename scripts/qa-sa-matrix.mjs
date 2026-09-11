/**
 * SA QA matrix: every admin surface, probed as every admin role, read-only.
 *
 * Run with: npm run qa:sa-matrix -- --out <file.json>
 *
 * GET only. This script performs no writes, creates no fixtures and mutates no shared record; it
 * exists to answer "which surfaces answer, which refuse, and which break" for the SA-0.1-SA-5.4
 * recheck. Sessions are signed locally with the secrets already in .env.local, exactly as
 * scripts/mint-session.mjs does, so no password is typed and none is printed.
 *
 * A 500 here almost always means the route reached the database and the table it wanted is not
 * there. That distinction — refused (401/403) versus broken (5xx) — is the whole point.
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const outArg = process.argv.indexOf("--out");
const outPath = outArg > -1 ? process.argv[outArg + 1] : null;

const ADMIN_ROLES = ["super_admin", "support_agent", "billing_admin", "platform_config"];
const TENANT_ROLES = ["owner", "assistant"]; // owner + a deliberately restricted member

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
  const { data } = await sb
    .from("admin_users")
    .select("id, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!data) return { role, cookie: null, reason: `no active admin_users row with role ${role}` };
  const token = await sign(process.env.ADMIN_SESSION_SECRET, {
    sub: data.id,
    role: data.role,
    stage: "authenticated",
  });
  return { role, cookie: `insurvas_admin_session=${token}` };
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
    });
    return response.status;
  } catch (error) {
    return `ERR ${error.message.slice(0, 40)}`;
  }
}

const adminApi = routes(join(process.cwd(), "app", "api", "admin"), "/api/admin");
const adminScreens = screens(join(process.cwd(), "app", "admin"), "/admin");

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
  const row = { anonymous: await probe(path, null) };
  for (const s of sessions) row[s.role] = s.cookie ? await probe(path, s.cookie) : "no-session";
  report.api[path] = row;
}

for (const path of adminScreens) {
  const row = { anonymous: await probe(path, null) };
  for (const s of sessions) row[s.role] = s.cookie ? await probe(path, s.cookie) : "no-session";
  report.screens[path] = row;
}

// A quick roll-up, because 100 rows of status codes is not a finding.
const flatten = (group) => Object.entries(group).flatMap(([path, row]) => Object.entries(row).map(([role, status]) => ({ path, role, status })));
const all = [...flatten(report.api), ...flatten(report.screens)];
report.summary = {
  server_errors: all.filter((r) => typeof r.status === "number" && r.status >= 500),
  anonymous_leaks: all.filter((r) => r.role === "anonymous" && r.status === 200),
  ok_counts: Object.fromEntries(
    ["anonymous", ...ADMIN_ROLES, ...TENANT_ROLES].map((role) => [
      role,
      all.filter((r) => r.role === role && r.status === 200).length,
    ]),
  ),
};

const json = JSON.stringify(report, null, 2);
if (outPath) {
  writeFileSync(outPath, json);
  console.log(`Wrote ${outPath}`);
} else {
  console.log(json);
}

console.log(`\nsessions: ${report.sessions.map((s) => `${s.role}=${s.available ? "ok" : "MISSING"}`).join("  ")}`);
console.log(`probed: ${adminApi.static.length} API routes + ${adminScreens.length} screens (${adminApi.dynamic.length} dynamic API routes skipped)`);
console.log(`200s by role: ${JSON.stringify(report.summary.ok_counts)}`);
console.log(`server errors (5xx): ${report.summary.server_errors.length}`);
console.log(`anonymous 200s (should be 0 on protected paths): ${report.summary.anonymous_leaks.length}`);
