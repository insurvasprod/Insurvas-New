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
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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

// The probe below is `/api/app/policies`, which is guarded by `book_of_business`. So the plan is
// chosen BY that feature rather than by sort order: "the first unarchived plan" is whatever
// happens to sort first, and a disposable fixture plan left behind by another suite sorts at 0 —
// ahead of Basic. This suite has already failed once that way, reporting "Plan pbv_1789272807076
// grants no features, so there is nothing to switch off", which reads like a product problem and
// is not one.
const FEATURE = "book_of_business";

const { data: grantRows, error: grantError } = await sb
  .from("plan_features")
  .select("plan_id")
  .eq("feature_key", FEATURE);
if (grantError) {
  console.error(`Could not read plan features: ${grantError.message}`);
  process.exit(1);
}

const { data: candidates, error: planError } = await sb
  .from("admin_plan_list")
  .select("id, code")
  .eq("is_archived", false)
  .in("id", (grantRows ?? []).map((row) => row.plan_id))
  .order("sort_order");
if (planError) {
  console.error(`Could not read plans: ${planError.message}`);
  process.exit(1);
}

const plan = candidates?.[0];
if (!plan) {
  console.error(`No unarchived plan grants ${FEATURE}, so there is nothing to switch off.`);
  process.exit(1);
}

// The owner is created in Supabase Auth and attached here.
//
// This used to call create_tenant_with_owner and fall back when it errored. That RPC inserts a
// public.users row with no id, which users_id_fkey has made impossible since SA-1.2, so the
// fallback ran every single time — and the diagnosis sat in a comment here while
// POST /api/admin/tenants went on calling the same broken function in production (backlog 193).
// The route is fixed; trying the broken path first buys nothing.
const { data: tenant, error: tenantError } = await sb
  .from("tenants")
  .insert({ name: `Kill switch verify ${stamp}`, status: "active", onboarding_state: "completed" })
  .select("id")
  .single();
if (tenantError) {
  console.error("Could not create the test tenant:", tenantError.message);
  process.exit(1);
}

const fixture = await createFixtureUser(sb, { email, name: "Kill Switch Verify" });
const membership = await sb.from("tenant_users").insert({
  tenant_id: tenant.id,
  user_id: fixture.userId,
  role: "owner",
  accepted_at: new Date().toISOString(),
});
if (membership.error) {
  await deleteFixtureUser(sb, fixture.userId);
  await sb.from("tenants").delete().eq("id", tenant.id);
  console.error("Could not create the test membership:", membership.error.message);
  process.exit(1);
}

const tenantId = tenant.id;
const userId = fixture.userId;

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
  await deleteFixtureUser(sb, userId);
  await sb.from("tenants").delete().eq("id", tenantId);
  console.log("  test tenant removed; the switch row is gone, so the feature is on again");
}

console.log(failures === 0 ? "\nAll kill switch checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
