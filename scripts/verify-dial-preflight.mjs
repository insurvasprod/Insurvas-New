// SA-4.8 agent-side compliance consumer verification. Temporary tenant data is removed in finally.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SUITE_SCRIPT = "verify:dial-preflight";

// Precondition. This suite proves FAIL-CLOSED screening, and `DEMO_SCREENING_MODE` short-circuits the
// provider so a missing or unreachable one answers cheerfully instead of refusing. Run against a
// demo-mode server the suite fails on an assertion that reads like a compliance defect and is not
// one — which is exactly what happened in the 2026-09-18 `verify:all` run, where this counted as one
// of ten failures for an environment reason nobody could see from the output.
//
// Said here, once, instead of left for whoever reads the assertion.
if (/^(1|true|yes|on)$/i.test(process.env.DEMO_SCREENING_MODE ?? "")) {
  console.error([
    "PRECONDITION NOT MET — this suite cannot prove fail-closed screening while DEMO_SCREENING_MODE is on.",
    "Start a server with it disabled and point the suite at that:",
    "  PORT=3110 DEMO_SCREENING_MODE=false npm start",
    `  APP_BASE_URL=http://localhost:3110 npm run ${SUITE_SCRIPT}`,
  ].join("\n"));
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let tenantId = null;
let userId = null;
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

async function cookie(tenant, user, secret = process.env.TENANT_SESSION_SECRET, expiry = "10m") {
  const token = await new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(user).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(secret));
  return `insurvas_tenant_session=${token}`;
}

async function api(path, requestCookie, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { cookie: requestCookie, ...(options.headers ?? {}) }, redirect: "manual" });
}

async function main() {
  const { data: plan, error: planError } = await supabase.from("plans").select("id").eq("code", "advance").eq("version", 1).single();
  if (planError || !plan) throw new Error(`Missing the advance plan fixture: ${planError?.message ?? "not found"}`);
  const tenant = await supabase.from("tenants").insert({ name: `SA48 dialer ${stamp}`, status: "active" }).select("id").single();
  if (tenant.error) throw new Error(tenant.error.message);
  tenantId = tenant.data.id;
  // public.users.id has no default and carries users_id_fkey to auth.users, so a direct insert
  // cannot work. createFixtureUser creates the Auth user first and lets the bridge trigger write the
  // public.users row. See scripts/lib/fixtureUser.mjs.
  ({ userId } = await createFixtureUser(supabase, { email: `sa48-dialer-${stamp}@invalid.test`, name: "SA-4.8 Dialer" }));
  await supabase.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  const assigned = await supabase.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() });
  if (assigned.error) throw new Error(assigned.error.message);
  const refreshed = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (refreshed.error) throw new Error(refreshed.error.message);
  const agentCookie = await cookie(tenantId, userId);

  console.log("Dial preflight authentication and input validation");
  check("missing session returns 401", (await api("/api/app/dial/preflight", "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "15551234567" }) })).status === 401);
  check("expired session returns 401", (await api("/api/app/dial/preflight", await cookie(tenantId, userId, process.env.TENANT_SESSION_SECRET, Math.floor(Date.now() / 1000) - 10), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "15551234567" }) })).status === 401);
  check("forged session returns 401", (await api("/api/app/dial/preflight", await cookie(tenantId, userId, `${process.env.TENANT_SESSION_SECRET}-forged`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "15551234567" }) })).status === 401);
  const hostile = await api("/api/app/dial/preflight", agentCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+1555<script>" }) });
  const hostileBody = await hostile.json();
  check("hostile phone input is rejected next to the phone field", hostile.status === 400 && hostileBody.field === "phone" && !JSON.stringify(hostileBody).includes("script"));

  console.log("Fail-closed dialing behavior");
  const vendorCount = await supabase.from("compliance_vendors").select("id", { count: "exact", head: true }).eq("vendor_type", "dnc_scrub").eq("is_enabled", true);
  if (vendorCount.count !== 0) {
    check("no enabled DNC vendor blocks the dial", false, "live fixture already has an enabled DNC vendor; no vendor state was changed by this script");
  } else {
    const blocked = await api("/api/app/dial/preflight", agentCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "15551234567" }) });
    const body = await blocked.json();
    check(
      "missing DNC vendor returns 503 and blocks dialing",
      blocked.status === 503 && body.code === "dnc_unavailable" && body.blocked === true && body.error.includes("Dialing is blocked platform-wide"),
      `status=${blocked.status} body=${JSON.stringify(body)}`,
    );
  }
}

try { await main(); } finally {
  if (tenantId) {
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
    await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
    await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
    await deleteFixtureUser(supabase, userId);
    await supabase.from("tenants").delete().eq("id", tenantId);
  }
}
console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll dial preflight checks passed.");
process.exit(failures ? 1 : 0);
