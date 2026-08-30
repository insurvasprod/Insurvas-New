// SA-4.3 route and permission verification.
//
// This script creates short-lived active fixtures for roles that may not exist in a local/live
// database, verifies every Configuration Center route, and removes those fixtures in finally.
// It does not write configuration data.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const sections = [
  "payments",
  "offers",
  "products",
  "templates",
  "compliance-sources",
  "credits-limits",
  "features",
  "email",
  "system",
  "advanced",
];
const routes = ["/admin/configuration", ...sections.map((section) => `/admin/configuration/${section}`)];
const expected = {
  super_admin: new Set(routes),
  support_agent: new Set(),
  platform_config: new Set([
    "/admin/configuration",
    ...sections
      .filter((section) => !["payments", "offers"].includes(section))
      .map((section) => `/admin/configuration/${section}`),
  ]),
  billing_admin: new Set(["/admin/configuration", "/admin/configuration/offers"]),
};

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function sign(adminId, role) {
  const token = await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  return `insurvas_admin_session=${token}`;
}

async function findOrCreate(role, stamp) {
  const { data: existing } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (existing) return { admin: existing, temporary: false };

  const { data: created, error } = await supabase
    .from("admin_users")
    .insert({
      email: `verify-configuration-${role}-${stamp}@insurvas.invalid`,
      name: `SA-4.3 ${role}`,
      role,
      password_hash: "verification-only",
      totp_secret: "verification-only",
      is_active: true,
    })
    .select("id, role")
    .single();
  if (error) throw new Error(`Could not create ${role} fixture: ${error.message}`);
  return { admin: created, temporary: true };
}

async function main() {
  const stamp = Date.now();
  const fixtures = [];

  try {
    for (const role of Object.keys(expected)) {
      const fixture = await findOrCreate(role, stamp);
      fixtures.push(fixture);
      const cookie = await sign(fixture.admin.id, role);

      for (const route of routes) {
        const response = await fetch(`${BASE}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        const shouldAllow = expected[role].has(route);
        const expectedStatus = shouldAllow ? 200 : 403;
        check(`${role} ${route} returns ${expectedStatus}`, response.status === expectedStatus, `got ${response.status}`);
      }
    }

    const unauthenticated = await fetch(`${BASE}/admin/configuration`, { redirect: "manual" });
    check("unauthenticated hub redirects to login", unauthenticated.status === 307, `got ${unauthenticated.status}`);
  } finally {
    for (const fixture of fixtures) {
      if (!fixture.temporary) continue;
      const { error } = await supabase.from("admin_users").delete().eq("id", fixture.admin.id);
      if (error) {
        console.error(`Could not remove ${fixture.admin.role} fixture ${fixture.admin.id}: ${error.message}`);
        failures++;
      }
    }
  }

  if (failures > 0) process.exitCode = 1;
  else console.log(`OK — ${routes.length * Object.keys(expected).length + 1} Configuration Center checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
