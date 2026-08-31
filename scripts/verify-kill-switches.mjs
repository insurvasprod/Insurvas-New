// SA-4.10 · Proves a kill switch actually denies, through the real HTTP stack.
//
// Run with: npm run verify:switches   (the dev server must be running)
//
// Why HTTP rather than importing the library: the acceptance criteria are about what the API and
// the route guard DO, not about what a pure function returns. The unit tests in
// lib/features/killSwitchRules.test.mjs already cover the rule; this covers the wiring.
//
// Provisions a throwaway tenant on a plan, exercises every switch state against it, and cleans up
// after itself — the same shape as verify-tenant-isolation.
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
for (const k of ["ADMIN_SESSION_SECRET", "TENANT_SESSION_SECRET"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k} — needed to mint the sessions this test drives the API with.`);
    process.exit(1);
  }
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  (got ${actual}, wanted ${expected})`}`);
}

async function sign(secret, claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

// ---------------------------------------------------------------- provisioning

const stamp = Date.now();
const email = `kill-switch-${stamp}@verify.invalid`;

console.log("Provisioning a throwaway tenant…");

const { data: plan } = await sb
  .from("admin_plan_list")
  .select("id, code")
  .eq("is_archived", false)
  .order("sort_order")
  .limit(1)
  .maybeSingle();

if (!plan) {
  console.error("No unarchived plan exists to subscribe a test tenant to.");
  process.exit(1);
}

const { data: granted } = await sb.from("plan_features").select("feature_key").eq("plan_id", plan.id);
const FEATURE = granted?.[0]?.feature_key;
if (!FEATURE) {
  console.error(`Plan ${plan.code} grants no features, so there is nothing to switch off.`);
  process.exit(1);
}

const { data: created, error: createError } = await sb.rpc("create_tenant_with_owner", {
  p_tenant_name: `Kill switch verify ${stamp}`,
  p_owner_name: "Kill Switch Verify",
  p_owner_email: email,
  p_owner_password_hash: "$2b$12$verifyverifyverifyverifyverifyverifyverifyverifyverifyverify",
});
if (createError) {
  console.error("Could not create the test tenant:", createError.message);
  process.exit(1);
}
const { tenant_id: tenantId, user_id: userId } = Array.isArray(created) ? created[0] : created;

const { error: subError } = await sb.rpc("admin_assign_subscription", {
  p_tenant_id: tenantId,
  p_plan_id: plan.id,
  p_billing_cycle: "monthly",
  p_start: new Date().toISOString(),
});
if (subError) console.log(`  note: could not assign a subscription (${subError.message}) — continuing`);

await sb.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });

const { data: admin } = await sb
  .from("admin_users")
  .select("id")
  .eq("role", "super_admin")
  .eq("is_active", true)
  .limit(1)
  .maybeSingle();

const tenantCookie = `insurvas_tenant_session=${await sign(process.env.TENANT_SESSION_SECRET, { sub: userId, tenantId })}`;
const adminCookie = `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: admin.id, role: "super_admin", stage: "authenticated" })}`;

console.log(`  tenant ${tenantId} on ${plan.code}, gated feature: ${FEATURE}\n`);

// ---------------------------------------------------------------- helpers

async function policiesStatus() {
  const res = await fetch(`${APP}/api/app/policies`, { headers: { cookie: tenantCookie } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body.code ?? null, error: body.error ?? null };
}

async function setSwitch(state, betaTenantIds = [], offMessage = null) {
  const res = await fetch(`${APP}/api/admin/feature-switches`, {
    method: "PUT",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({
      feature_key: FEATURE,
      state,
      beta_tenant_ids: betaTenantIds,
      off_message: offMessage,
      reason: `automated verification ${stamp}`,
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------- the criteria

try {
  console.log("Baseline — the plan grants it, no switch set");
  check("the API allows it", (await policiesStatus()).status, 200);

  console.log("\nCriterion: killing hides it from a tenant whose plan INCLUDES it");
  check("the switch saves", (await setSwitch("off", [], "Verification run.")).status, 200);
  const killed = await policiesStatus();
  check("the API now refuses", killed.status, 503);
  check("with a maintenance code, not an upgrade prompt", killed.code, "feature_unavailable");
  check("and the admin's message reaches the agent", killed.error, "Verification run.");

  console.log("\nCriterion: beta shows the feature to listed tenants and nobody else");
  await setSwitch("beta", [tenantId]);
  check("a listed tenant is allowed", (await policiesStatus()).status, 200);

  await setSwitch("beta", ["00000000-0000-4000-8000-000000000000"]);
  check("an unlisted tenant is refused", (await policiesStatus()).status, 503);

  console.log("\nCriterion: turning it back on restores access without a re-login");
  await setSwitch("on");
  // Deliberately the SAME session cookie throughout — nothing was re-issued.
  check("the same session works again", (await policiesStatus()).status, 200);

  console.log("\nGuards");
  const noReason = await fetch(`${APP}/api/admin/feature-switches`, {
    method: "PUT",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ feature_key: FEATURE, state: "off", beta_tenant_ids: [], off_message: null, reason: "no" }),
  });
  check("a switch with no real reason is refused", noReason.status, 400);

  const emptyBeta = await setSwitch("beta", []);
  check("beta with an empty list is refused", emptyBeta.status, 400);

  const unauth = await fetch(`${APP}/api/admin/feature-switches`, { method: "PUT", body: "{}" });
  check("an unauthenticated toggle is refused", unauth.status, 401);

  const bogus = await fetch(`${APP}/api/admin/feature-switches`, {
    method: "PUT",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({
      feature_key: "no_such_feature_anywhere",
      state: "off",
      beta_tenant_ids: [],
      off_message: null,
      reason: "verifying the foreign key",
    }),
  });
  check("a switch on a non-existent feature is refused", bogus.status, 400);

  console.log("\nAudit");
  const { count } = await sb
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "feature.switch_changed")
    .ilike("reason", `%${stamp}%`);
  check("every accepted toggle was audit-logged with its reason", (count ?? 0) >= 4, true);
} finally {
  console.log("\nCleaning up…");
  await sb.from("feature_switches").delete().eq("feature_key", FEATURE);
  await sb.from("subscriptions").delete().eq("tenant_id", tenantId);
  await sb.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await sb.from("tenant_users").delete().eq("tenant_id", tenantId);
  await sb.from("users").delete().eq("id", userId);
  await sb.from("tenants").delete().eq("id", tenantId);
  console.log("  test tenant removed; the switch row is gone, so the feature is on again");
}

console.log(failures === 0 ? "\nAll kill switch checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
