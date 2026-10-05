import "./lib/refuseProduction.mjs";
// SA-4.10 · Proves the kill-switch TTL across two independent Node processes.
//
// Run with two production servers already running:
//   npm run start -- -p 3200
//   npm run start -- -p 3201
//   npm run verify:switches:multi
//
// The first request warms both processes with the feature ON. The toggle is then sent to process A
// and process B must discover it from Supabase within sixty seconds, without relying on process A's
// in-memory invalidation. This verifies the deployed behaviour without pretending two local
// processes are a Vercel deployment.
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_A = process.env.KILL_SWITCH_APP_A || "http://localhost:3200";
const APP_B = process.env.KILL_SWITCH_APP_B || "http://localhost:3201";

if (!url || !serviceKey) throw new Error("Missing Supabase environment variables");
for (const key of ["ADMIN_SESSION_SECRET", "TENANT_SESSION_SECRET"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = Date.now();
const email = `kill-switch-multi-${stamp}@verify.invalid`;
let tenantId;
let userId;
let featureKey;
let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` (got ${actual}, wanted ${expected})`}`);
}

async function sign(secret, claims) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

async function policyStatus(app, cookie) {
  const response = await fetch(`${app}/api/app/policies`, {
    headers: { cookie },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, code: body.code ?? null };
}

async function setSwitch(app, cookie, state) {
  const response = await fetch(`${app}/api/admin/feature-switches`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      feature_key: featureKey,
      state,
      beta_tenant_ids: [],
      off_message: state === "off" ? "Multi-process verification." : null,
      reason: `automated multi-process verification ${stamp}`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  return response.status;
}

async function waitForStatus(app, cookie, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await policyStatus(app, cookie);
    if (latest.status === expected) return { ...latest, elapsedMs: Date.now() - (deadline - timeoutMs) };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ...latest, elapsedMs: timeoutMs };
}

try {
  console.log(`Testing ${APP_A} and ${APP_B} as independent processes…`);
  // The plan is chosen BY the feature this suite toggles, and the feature is the one that actually
  // guards the probe. Both used to be "whichever sorts first": the plan came from `order(sort_order)
  // .limit(1)`, which a disposable fixture plan left by another suite wins at sort_order 0, and the
  // feature came from `granted[0]`, which is not necessarily the one /api/app/policies is gated on.
  // The single-process variant already carried a comment about the second half; this is both.
  featureKey = "book_of_business";

  const { data: grantRows, error: grantedError } = await sb
    .from("plan_features")
    .select("plan_id")
    .eq("feature_key", featureKey);
  if (grantedError) throw new Error(grantedError.message);

  const { data: candidates, error: planError } = await sb
    .from("admin_plan_list")
    .select("id, code")
    .eq("is_archived", false)
    .in("id", (grantRows ?? []).map((row) => row.plan_id))
    .order("sort_order");
  if (planError) throw new Error(planError.message);

  const plan = candidates?.[0];
  if (!plan) throw new Error(`No unarchived plan grants ${featureKey}`);

  // Auth-first, like everything else that creates a user.
  //
  // This called create_tenant_with_owner and threw on error. That RPC inserts a public.users row
  // with no id, which users_id_fkey has made impossible since SA-1.2 — so this suite could not get
  // past its own fixture, and nobody noticed because it is deliberately excluded from verify:all
  // (it needs two servers). An excluded suite that cannot run is indistinguishable from one that
  // is merely not being run.
  const { data: tenant, error: tenantError } = await sb
    .from("tenants")
    .insert({ name: `Kill switch multi verify ${stamp}`, status: "active", onboarding_state: "completed" })
    .select("id")
    .single();
  if (tenantError) throw new Error(tenantError.message);
  tenantId = tenant.id;

  ({ userId } = await createFixtureUser(sb, { email, name: "Kill Switch Multi Verify" }));

  const { error: membershipError } = await sb.from("tenant_users").insert({
    tenant_id: tenantId,
    user_id: userId,
    role: "owner",
    accepted_at: new Date().toISOString(),
  });
  if (membershipError) throw new Error(membershipError.message);

  const { error: subscriptionError } = await sb.rpc("admin_assign_subscription", {
    p_tenant_id: tenantId,
    p_plan_id: plan.id,
    p_billing_cycle: "monthly",
    p_start: new Date().toISOString(),
  });
  if (subscriptionError) throw new Error(subscriptionError.message);
  const { error: entitlementError } = await sb.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (entitlementError) throw new Error(entitlementError.message);

  const { data: admin, error: adminError } = await sb
    .from("admin_users")
    .select("id")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (adminError || !admin) throw new Error(adminError?.message || "No active super admin exists");

  const tenantCookie = `insurvas_tenant_session=${await sign(process.env.TENANT_SESSION_SECRET, { sub: userId, tenantId })}`;
  const adminCookie = `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: admin.id, role: "super_admin", stage: "authenticated" })}`;

  console.log(`  tenant ${tenantId}, feature ${featureKey}`);
  console.log("Warming both process-local caches with the feature ON…");
  await sb.from("feature_switches").delete().eq("feature_key", featureKey);
  check("process A starts enabled", (await policyStatus(APP_A, tenantCookie)).status, 200);
  check("process B starts enabled", (await policyStatus(APP_B, tenantCookie)).status, 200);

  console.log("Toggling OFF through process A…");
  check("process A accepts the toggle", await setSwitch(APP_A, adminCookie, "off"), 200);
  check("process A refuses immediately", (await policyStatus(APP_A, tenantCookie)).status, 503);

  const staleOnB = await policyStatus(APP_B, tenantCookie);
  console.log(`  process B before TTL expiry: ${staleOnB.status} (independent-cache proof)`);
  const deadlineResult = await waitForStatus(APP_B, tenantCookie, 503, 60_000);
  check("process B refuses within 60 seconds", deadlineResult.status, 503);
  check("process B reports feature_unavailable", deadlineResult.code, "feature_unavailable");
  console.log(`  process B changed after ${deadlineResult.elapsedMs}ms`);

  console.log("Restoring ON through process A…");
  check("process A accepts restore", await setSwitch(APP_A, adminCookie, "on"), 200);
  check("process A is enabled again", (await policyStatus(APP_A, tenantCookie)).status, 200);
  const restoredOnB = await waitForStatus(APP_B, tenantCookie, 200, 60_000);
  check("process B is enabled again within 60 seconds", restoredOnB.status, 200);
  console.log(`  process B restored after ${restoredOnB.elapsedMs}ms`);
} finally {
  console.log("Cleaning up…");
  if (featureKey) await sb.from("feature_switches").delete().eq("feature_key", featureKey);
  if (tenantId) {
    await sb.from("subscriptions").delete().eq("tenant_id", tenantId);
    await sb.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
    await sb.from("tenant_users").delete().eq("tenant_id", tenantId);
    await sb.from("tenants").delete().eq("id", tenantId);
  }
  // deleteFixtureUser, not a delete on public.users. Removing only the public row leaves the
  // auth.users identity behind, and that orphan holds the email address against the next run.
  if (userId) await deleteFixtureUser(sb, userId);
}

console.log(failures === 0 ? "\nAll multi-process kill-switch checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
