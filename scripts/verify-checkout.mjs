// SA-5.2 acceptance: hosted checkout, trial start, and the subscription that backlog #47 was
// missing.
//
// Drives the real HTTP routes with a minted tenant session. It opens a REAL Whop checkout in the
// sandbox (no card is entered, so nothing is charged) and then completes it through both paths —
// the return handler and the webhook — to prove they are idempotent.
//
// Needs the app running. Everything is under a throwaway tenant and removed. Run: npm run verify:checkout
import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const made = { tenants: [], users: [] };

async function makeSignedUpTenant(label) {
  const { data: user } = await supabase
    .from("users")
    .insert({ email: `checkout_${label}_${stamp}@insurvas.test`, name: `Checkout ${label}`, password_hash: "x", status: "active" })
    .select("id").single();
  const { data: tenant } = await supabase
    .from("tenants")
    .insert({ name: `Checkout ${label} ${stamp}`, status: "provisioning", onboarding_state: "ready_for_checkout" })
    .select("id").single();
  await supabase.from("tenant_users").insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

  const { data: plan } = await supabase
    .from("plans").select("id").eq("code", "plan_a").eq("version", 1).single();
  await supabase.from("signup_selections").insert({ tenant_id: tenant.id, plan_id: plan.id, billing_cycle: "monthly" });

  const token = await new SignJWT({ tenantId: tenant.id })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));

  made.tenants.push(tenant.id);
  made.users.push(user.id);
  return { tenantId: tenant.id, userId: user.id, planId: plan.id, cookie: `insurvas_tenant_session=${token}` };
}

async function cleanup() {
  for (const id of made.tenants) {
    await supabase.from("checkout_sessions").delete().eq("tenant_id", id);
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("signup_selections").delete().eq("tenant_id", id);
    await supabase.from("tenant_users").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  for (const id of made.users) await supabase.from("users").delete().eq("id", id);
  await supabase.from("webhook_events").delete().like("event_id", `msg_co_${stamp}%`);
}

/** Sends a signed membership.activated, the way Whop does. */
async function sendMembershipActivated(id, tenantId, planId, membershipId) {
  const envelope = {
    id, type: "membership.activated", api_version: "v1", timestamp: new Date().toISOString(),
    data: {
      id: membershipId,
      metadata: { tenant_id: tenantId },
      plan: { id: "plan_x", metadata: { insurvas_plan_id: planId, insurvas_billing_cycle: "monthly" } },
    },
  };
  const raw = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.WHOP_WEBHOOK_SECRET).update(`${id}.${ts}.${raw}`).digest("base64");
  return fetch(`${BASE}/api/webhooks/whop`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    },
    body: raw,
  });
}

const post = (path, cookie, body) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body ?? {}) });

try {
  console.log("Opening checkout\n");

  const a = await makeSignedUpTenant("A");

  const bad = await post("/api/app/checkout/coupon", a.cookie, { code: "DEFINITELY-NOT-A-CODE" });
  check("an invalid coupon is rejected BEFORE checkout opens", bad.status === 409, String(bad.status));

  const started = await post("/api/app/checkout/start", a.cookie);
  const body = await started.json();
  check("checkout opens", started.status === 200, JSON.stringify(body).slice(0, 160));
  check("it returns a provider-hosted URL", (body.checkoutUrl ?? "").includes("whop.com/checkout"), body.checkoutUrl);
  check("the trial is 14 days", body.trialDays === 14, String(body.trialDays));

  const { data: tenantAfter } = await supabase
    .from("tenants").select("onboarding_state").eq("id", a.tenantId).single();
  check(
    "abandoning leaves the tenant in awaiting_payment, not a broken half-account",
    tenantAfter.onboarding_state === "awaiting_payment",
    tenantAfter.onboarding_state,
  );

  const again = await post("/api/app/checkout/start", a.cookie);
  const againBody = await again.json();
  check("returning reuses the same checkout rather than opening another",
        againBody.checkoutUrl === body.checkoutUrl, "a second session would strand the first");

  console.log("\nThe return path must not grant access on its own — bugs_sa.md #1 (P0)\n");

  // Tenant A opened a checkout and never paid, so Whop has no membership for them. Landing on the
  // return URL — which anybody signed in can type — must therefore grant nothing. Before the fix
  // this handler trusted the local plan selection and issued a free trial to whoever asked.
  const returned = await fetch(`${BASE}/app/checkout/return`, { headers: { cookie: a.cookie }, redirect: "manual" });
  check("the return page redirects rather than erroring", [302, 307].includes(returned.status), String(returned.status));

  const { data: unpaid } = await supabase
    .from("subscriptions").select("status").eq("tenant_id", a.tenantId).maybeSingle();
  check(
    "visiting the return URL without paying grants NOTHING",
    unpaid === null,
    "a subscription exists for a tenant Whop has no membership for — free access to the product",
  );

  const { data: noEnt } = await supabase
    .from("tenant_entitlements").select("entitlement").eq("tenant_id", a.tenantId).maybeSingle();
  check("and no full entitlement is built", noEnt?.entitlement?.access !== "full",
        `access=${noEnt?.entitlement?.access}`);

  const { data: stillWaiting } = await supabase
    .from("tenants").select("onboarding_state").eq("id", a.tenantId).single();
  check("the tenant stays in awaiting_payment", stillWaiting.onboarding_state === "awaiting_payment",
        stillWaiting.onboarding_state);

  console.log("\nOnce Whop confirms, the same tenant is completed\n");

  // Whop's signed event is the authority. With it, everything the ticket promises must hold.
  const idA = `msg_co_${stamp}_a`;
  await sendMembershipActivated(idA, a.tenantId, a.planId, `mem_co_${stamp}_a`);

  const { data: sub } = await supabase
    .from("subscriptions").select("status, trial_ends_at, plan_id, billing_cycle").eq("tenant_id", a.tenantId).maybeSingle();
  check("a subscription now exists — this is backlog #47", Boolean(sub), "none was created");
  check("it starts in trialing", sub?.status === "trialing", String(sub?.status));
  check("trial_ends_at is set ~14 days out", (() => {
    if (!sub?.trial_ends_at) return false;
    const days = Math.round((new Date(sub.trial_ends_at) - Date.now()) / 86_400_000);
    return days === 14;
  })(), String(sub?.trial_ends_at));

  const { data: ent } = await supabase
    .from("tenant_entitlements").select("entitlement").eq("tenant_id", a.tenantId).maybeSingle();
  check("the entitlement is built", ent?.entitlement?.access === "full",
        `access=${ent?.entitlement?.access} — the ticket requires the product to work on landing`);
  check("the menu has the plan's features", (ent?.entitlement?.features ?? []).length > 0,
        `${(ent?.entitlement?.features ?? []).length} features`);

  const { data: tenantDone } = await supabase
    .from("tenants").select("status, onboarding_state").eq("id", a.tenantId).single();
  check("the tenant is active and out of onboarding",
        tenantDone.status === "active" && tenantDone.onboarding_state === "completed",
        JSON.stringify(tenantDone));

  console.log("\nIdempotency — the customer also lands on the return page\n");

  const beforeCount = (await supabase.from("subscriptions").select("id").eq("tenant_id", a.tenantId)).data.length;
  await fetch(`${BASE}/app/checkout/return`, { headers: { cookie: a.cookie }, redirect: "manual" });
  const afterCount = (await supabase.from("subscriptions").select("id").eq("tenant_id", a.tenantId)).data.length;
  check("returning after the webhook creates no second subscription",
        beforeCount === afterCount && afterCount === 1, `${beforeCount} then ${afterCount}`);

  console.log("\nThe webhook path on its own — the customer who closes the tab\n");

  const b = await makeSignedUpTenant("B");
  const hook = await sendMembershipActivated(`msg_co_${stamp}_b`, b.tenantId, b.planId, `mem_co_${stamp}`);
  check("the webhook is accepted", hook.status === 200, String(hook.status));

  const { data: subB } = await supabase
    .from("subscriptions").select("status, whop_membership_id").eq("tenant_id", b.tenantId).maybeSingle();
  check(
    "a customer who never returns still gets a subscription",
    Boolean(subB),
    "this is the half of #47 the return handler cannot cover",
  );
  check("the membership id is captured", subB?.whop_membership_id === `mem_co_${stamp}`, String(subB?.whop_membership_id));
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll checkout checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
