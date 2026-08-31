/**
 * Mints a signed session cookie for manual and automated UI verification.
 *
 * Backlog #8: twenty-four admin screens and nine agent screens exist, and roughly a dozen have ever
 * been opened in a browser. The obstacle was never the screens — it was that every one of them sits
 * behind a login, so checking a layout meant typing a password first.
 *
 * The verification suites already solve this: verify-kill-switches-multi.mjs signs its own session
 * cookie with the same secret the app verifies against, and drives the running server as an
 * authenticated caller. This does the same thing and prints the cookie instead of using it, so a
 * browser can carry it.
 *
 * Local development only. It reads the secrets out of .env.local and signs a short-lived token; it
 * cannot forge a session against any server that does not share those secrets.
 *
 *   node --env-file=.env.local scripts/mint-session.mjs admin
 *   node --env-file=.env.local scripts/mint-session.mjs admin --role billing_admin
 *   node --env-file=.env.local scripts/mint-session.mjs tenant
 *   node --env-file=.env.local scripts/mint-session.mjs admin --js    # a document.cookie one-liner
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import process from "node:process";

const plane = process.argv[2];
if (plane !== "admin" && plane !== "tenant") {
  console.error("usage: mint-session.mjs <admin|tenant> [--role <role>] [--ttl <minutes>] [--js]");
  process.exit(1);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const asJs = process.argv.includes("--js");
const ttl = `${arg("ttl", "60")}m`;

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_SESSION_SECRET", "TENANT_SESSION_SECRET"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Run with --env-file=.env.local`);
    process.exit(1);
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function sign(secret, claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}

let name;
let token;
let who;

if (plane === "admin") {
  const role = arg("role", "super_admin");
  // Prefer a real admin with that role; the id has to exist because screens load the record.
  const { data, error } = await sb
    .from("admin_users")
    .select("id, name, email, role")
    .eq("role", role)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    console.error(`No active admin_users row with role "${role}".`);
    console.error("Roles present:");
    const { data: roles } = await sb.from("admin_users").select("role").eq("is_active", true);
    for (const r of new Set((roles || []).map((r) => r.role))) console.error(`  ${r}`);
    process.exit(1);
  }
  name = "insurvas_admin_session";
  // stage: "authenticated" is what clears the TOTP step — this session is already past it.
  token = await sign(process.env.ADMIN_SESSION_SECRET, { sub: data.id, role: data.role, stage: "authenticated" });
  who = `${data.name} <${data.email}> as ${data.role}`;
} else {
  const { data, error } = await sb
    .from("tenant_users")
    .select("user_id, tenant_id, users(name, email), tenants(name)")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    console.error("No tenant_users row exists — create a tenant first.");
    process.exit(1);
  }
  name = "insurvas_tenant_session";
  token = await sign(process.env.TENANT_SESSION_SECRET, { sub: data.user_id, tenantId: data.tenant_id });
  who = `${data.users?.email ?? data.user_id} in ${data.tenants?.name ?? data.tenant_id}`;
}

if (asJs) {
  process.stdout.write(`document.cookie=${JSON.stringify(`${name}=${token}; path=/; SameSite=Lax`)};location.reload()`);
} else {
  console.log(`# ${who}`);
  console.log(`# expires in ${ttl}`);
  console.log(`${name}=${token}`);
}
