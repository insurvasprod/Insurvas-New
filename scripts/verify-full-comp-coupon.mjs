import "./lib/refuseProduction.mjs";
// A 100%-off-forever coupon starts a plan with nothing charged, ever (lib/checkout/fullComp.ts). LIVE check.
//
// It signs up a temporary owner on a priced plan and checks the coupon through the real checkout routes. Then
// it asserts:
// - no payment page and no checkout session;
// - no call to the payment provider;
// - a subscription that is on, on manual billing, with a comp recorded;
// - the redemption is counted once;
// - the period billing run raises no invoice even with a charge pending.
// Everything is cleaned up, and the coupon's count is restored.
//
//   VERIFY_ALLOW_PRODUCTION=1 BASE_URL=http://127.0.0.1:3100 node --experimental-strip-types --env-file=.env.local \
//     scripts/verify-full-comp-coupon.mjs --code INSURVAS100
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";
import { billSubscriptionPeriod } from "../lib/billing/gather.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; };
const CODE = arg("code", "INSURVAS100");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`); if (!ok) failures++; };
const must = async (p, what) => { const { data, error } = await p; if (error) throw new Error(`${what}: ${error.message}`); return data; };
const created = { tenantId: null, user: null, couponId: null, countBefore: null };

async function main() {
  const coupon = await must(sb.from("coupons").select("id, redeemed_count, percent_off, duration, is_active").eq("code", CODE).maybeSingle(), "coupon");
  if (!coupon) throw new Error(`No coupon ${CODE}.`);
  created.couponId = coupon.id;
  created.countBefore = coupon.redeemed_count;
  check(`${CODE} is 100% off forever and active`, coupon.percent_off === 100 && coupon.duration === "forever" && coupon.is_active);

  // A plan that really costs money, so "nothing charged" is a real claim.
  const prices = await must(sb.from("plan_prices").select("plan_id, price_monthly_cents").gt("price_monthly_cents", 0).limit(20), "prices");
  const plans = await must(sb.from("plans").select("id, name, is_archived, is_public").in("id", prices.map((p) => p.plan_id)), "plans");
  const plan = plans.find((p) => !p.is_archived && p.is_public);
  if (!plan) throw new Error("No public priced plan.");
  const price = prices.find((p) => p.plan_id === plan.id).price_monthly_cents;

  const tenant = await must(sb.from("tenants").insert({ name: `FC${stamp} Full comp check`, status: "active" }).select("id").single(), "tenant");
  created.tenantId = tenant.id;
  created.user = await createFixtureUser(sb, { email: `fc-${stamp}@insurvas.test`, name: `FC${stamp}`, password: "VerifyFullComp123!" });
  await must(sb.from("tenant_users").insert({ tenant_id: tenant.id, user_id: created.user.userId, role: "owner", accepted_at: new Date().toISOString() }), "owner");
  await must(sb.from("signup_selections").insert({ tenant_id: tenant.id, plan_id: plan.id, billing_cycle: "monthly" }), "plan choice");
  const { data: u } = await sb.from("users").select("session_version").eq("id", created.user.userId).single();
  const token = await new SignJWT({ sub: created.user.userId, tenantId: tenant.id, sessionVersion: u?.session_version ?? 0 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(created.user.userId).setIssuedAt().setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  const post = async (path, body) => {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { cookie: `insurvas_tenant_session=${token}`, "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  console.log(`\nPlan "${plan.name}" at $${(price / 100).toFixed(2)}/month, coupon ${CODE}`);

  let r = await post("/api/app/checkout/coupon", { code: CODE });
  check("the coupon check says free, no card needed", r.status === 200 && r.json?.fullComp === true && r.json?.mustEnterAtCheckout === false, JSON.stringify(r.json));

  r = await post("/api/app/checkout/start", { couponCode: CODE });
  check("checkout goes straight into the workspace, not to a payment page", r.status === 200 && r.json?.checkoutUrl === "/app/setup", JSON.stringify(r.json));

  const subs = await must(sb.from("subscriptions").select("id, status, plan_id, whop_membership_id").eq("tenant_id", tenant.id), "subscriptions");
  check("one subscription, on the chosen plan, started", subs.length === 1 && subs[0].plan_id === plan.id && ["active", "trialing"].includes(subs[0].status), JSON.stringify(subs));
  check("no payment-provider membership exists to charge", subs.every((s) => !s.whop_membership_id));
  const t = await must(sb.from("tenants").select("billing_mode").eq("id", tenant.id).single(), "tenant mode");
  check("billing is manual (nothing automatic can charge)", t.billing_mode === "manual");
  const comps = await must(sb.from("tenant_comps").select("id, reason").eq("tenant_id", tenant.id).is("ended_at", null), "comps");
  check("the tenant is recorded as comped", comps.length === 1 && comps[0].reason.includes(CODE), JSON.stringify(comps));
  const sessions = await must(sb.from("checkout_sessions").select("id").eq("tenant_id", tenant.id), "sessions");
  check("no checkout session was opened", sessions.length === 0);
  const calls = await sb.from("provider_calls").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  check("no call was made to the payment provider", !calls.error && (calls.count ?? 0) === 0, calls.error?.message ?? `${calls.count}`);
  const methods = await sb.from("payment_providers").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  check("no payment method is on file", !methods.error && (methods.count ?? 0) === 0, methods.error?.message ?? `${methods.count}`);
  let c = await must(sb.from("coupons").select("redeemed_count").eq("id", coupon.id).single(), "count");
  check("the redemption was counted once", c.redeemed_count === created.countBefore + 1, `${created.countBefore} -> ${c.redeemed_count}`);

  r = await post("/api/app/checkout/start", { couponCode: CODE });
  c = await must(sb.from("coupons").select("redeemed_count").eq("id", coupon.id).single(), "count");
  check("pressing checkout again starts nothing new and counts nothing", r.status === 200 && c.redeemed_count === created.countBefore + 1 && (await must(sb.from("subscriptions").select("id").eq("tenant_id", tenant.id), "subs")).length === 1);

  // The period billing run, for this subscription only, with a charge pending that would normally be invoiced.
  const sub = subs[0];
  const start = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const end = new Date(Date.now() - 86_400_000).toISOString();
  const pending = await sb.from("pending_charges").insert({ tenant_id: tenant.id, subscription_id: sub.id, kind: "addon", label: "Full comp check", quantity: 1, unit_cents: 5000, amount_cents: 5000, reason: "verify-full-comp-coupon" });
  check("a $50 charge is pending (so a normal tenant would be invoiced)", !pending.error, pending.error?.message);
  const outcome = await billSubscriptionPeriod(sb, { id: sub.id, tenant_id: tenant.id, tenant_name: "FC", billing_cycle: "monthly", current_period_start: start, current_period_end: end, status: sub.status });
  check("the period billing run raised no invoice and asked for no money", !outcome.error && outcome.invoiceId === null && outcome.totalCents === 0 && !outcome.payOnlineUrl, JSON.stringify(outcome));
}

try {
  await main();
} catch (error) {
  failures++;
  console.error(`\nFAIL ${error.message}`);
} finally {
  const leftovers = [];
  if (created.couponId !== null && created.countBefore !== null) {
    const { error } = await sb.from("coupons").update({ redeemed_count: created.countBefore }).eq("id", created.couponId);
    if (error) leftovers.push(`coupon count: ${error.message}`);
  }
  if (created.tenantId) {
    // Billing rows refuse deletes; cancel and purge the workspace (an empty, cancelled shell remains by design).
    await sb.from("subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("tenant_id", created.tenantId);
    const { data: row } = await sb.from("tenants").select("name").eq("id", created.tenantId).maybeSingle();
    if (row) {
      const purge = await sb.rpc("purge_tenant_workspace", { p_tenant_id: created.tenantId, p_actor: null, p_reason: "Full comp coupon live check cleanup", p_confirm_name: row.name });
      if (purge.error) leftovers.push(`purge: ${purge.error.message}`);
    }
  }
  if (created.user) await deleteFixtureUser(sb, created.user.userId).catch((error) => leftovers.push(`user: ${error.message}`));
  if (leftovers.length) { failures++; console.error(`\nCLEANUP INCOMPLETE (tenant ${created.tenantId}):\n  ${leftovers.join("\n  ")}`); }
  else console.log(`\ncleaned up: workspace ${created.tenantId} purged (an empty, cancelled shell remains by design); coupon count restored`);
  console.log(failures ? `\n${failures} FAILURE(S).` : "\nFull-comp coupon live check passed: nothing charged, nothing invoiced.");
  process.exit(failures ? 1 : 0);
}
