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
 *   node --env-file=.env.local scripts/mint-session.mjs tenant --role owner
 *   node --env-file=.env.local scripts/mint-session.mjs partner                    # any active partner user
 *   node --env-file=.env.local scripts/mint-session.mjs partner --role partner_admin
 *   node --env-file=.env.local scripts/mint-session.mjs admin --js    # a document.cookie one-liner
 */
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import process from "node:process";

const plane = process.argv[2];
if (plane !== "admin" && plane !== "tenant" && plane !== "partner") {
  console.error("usage: mint-session.mjs <admin|tenant|partner> [--role <role>] [--email <addr>] [--ttl <minutes>] [--js]");
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
  // `--email` pins the account (e.g. the QA staff account), so a test session is never minted as a
  // real person's staff login. Without it: the first active admin with that role, as before.
  const email = arg("email", null);
  // Prefer a real admin with that role; the id has to exist because screens load the record.
  let query = sb.from("admin_users").select("id, name, email, role").eq("role", role).eq("is_active", true);
  if (email) query = query.ilike("email", email);
  const { data, error } = await query.limit(1).maybeSingle();
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
} else if (plane === "partner") {
  const role = arg("role", null);
  const email = arg("email", null);
  // The same conditions resolvePartnerContext enforces on every request: an active, accepted
  // membership, an active user, and a partner organisation that exists. Anything else verifies and
  // then bounces to /partner/login with nothing saying why.
  let query = sb
    .from("partner_users")
    .select("user_id, tenant_id, partner_id, role, status, accepted_at, users!partner_users_user_id_fkey!inner(email, status, session_version), partners!inner(name, status)")
    .eq("status", "active")
    .not("accepted_at", "is", null)
    .eq("users.status", "active")
    .limit(1);
  if (role) query = query.eq("role", role);
  if (email) query = query.eq("users.email", email);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    console.error("No active, accepted partner_users row matches" + (role || email ? " those filters." : "."));
    process.exit(1);
  }
  name = "insurvas_partner_session";
  // lib/partnerAuth/session.ts: PARTNER_SESSION_SECRET, else the tenant secret under a namespace
  // prefix — never the bare tenant secret, so a partner token can never pass as an agent one.
  const secret = process.env.PARTNER_SESSION_SECRET || `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
  token = await sign(secret, {
    sub: data.user_id,
    tenantId: data.tenant_id,
    partnerId: data.partner_id,
    sessionVersion: data.users?.session_version ?? 0,
  });
  who = `${data.users?.email ?? data.user_id} (${data.role}) at ${data.partners?.name ?? data.partner_id}`;
} else {
  const role = arg("role", null);
  const email = arg("email", null);
  // `resolveTenantContext` drops a session whose user is not active, so a token minted for a
  // deactivated user verifies fine and then bounces to the login page with nothing explaining why.
  // Filter on the same conditions the request path enforces, and say so when nothing matches.
  let query = sb
    .from("tenant_users")
    .select("user_id, tenant_id, role, users!inner(name, email, session_version, status), tenants!inner(name, status)")
    .eq("users.status", "active")
    .eq("tenants.status", "active")
    .limit(1);
  if (role) query = query.eq("role", role);
  if (email) query = query.eq("users.email", email);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const wanted = [role && `role "${role}"`, email && `email "${email}"`].filter(Boolean).join(" and ");
    console.error(
      wanted
        ? `No active tenant_users row with ${wanted} in an active tenant.`
        : "No active tenant_users row exists — create a tenant first.",
    );
    process.exit(1);
  }
  name = "insurvas_tenant_session";
  token = await sign(process.env.TENANT_SESSION_SECRET, {
    sub: data.user_id,
    tenantId: data.tenant_id,
    sessionVersion: data.users?.session_version ?? 0,
  });
  who = `${data.users?.email ?? data.user_id} in ${data.tenants?.name ?? data.tenant_id}`;
}

if (asJs) {
  process.stdout.write(`document.cookie=${JSON.stringify(`${name}=${token}; path=/; SameSite=Lax`)};location.reload()`);
} else {
  console.log(`# ${who}`);
  console.log(`# expires in ${ttl}`);
  console.log(`${name}=${token}`);
}
