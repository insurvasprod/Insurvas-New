// bugs_sa.md M2-5 · The server must enforce the subscription transition graph, not just the UI.
//
// `resume` was a bare status write, so it acted as a universal "make it active": one crafted
// request restored full entitlement to a cancelled subscription. The UI never offered the button,
// which is exactly why nobody noticed — a hidden button is a courtesy, not a rule.
//
// Drives the real admin route with a minted session. Everything is removed. Run: npm run verify:transitions
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (l, c, d = "") => { console.log(c ? `  ok   ${l}` : `  FAIL ${l}${d ? " — " + d : ""}`); if (!c) failures++; };

const stamp = Date.now();
const tenants = [];

const { data: admin } = await supabase.from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).single();
const cookie = `insurvas_admin_session=${await new SignJWT({ role: "super_admin", stage: "authenticated" })
  .setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;

const { data: plan } = await supabase.from("plans").select("id").eq("code", "basic").order("version", { ascending: false }).limit(1).single();

async function subscriptionIn(status) {
  const { data: t } = await supabase.from("tenants").insert({ name: `M2-5 ${status} ${stamp}`, status: "active" }).select("id").single();
  tenants.push(t.id);
  const { data: sub } = await supabase.from("subscriptions").insert({
    tenant_id: t.id, plan_id: plan.id, status, billing_cycle: "monthly",
    started_at: new Date().toISOString(), current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
  }).select("id").single();
  return sub.id;
}

const act = (id, action, extra = {}) => fetch(`${BASE}/api/admin/subscriptions/${id}`, {
  method: "POST", headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ action, ...extra }),
});

try {
  console.log("Invalid transitions must be refused by the SERVER\n");

  for (const status of ["cancelled", "suspended", "past_due", "trialing", "active"]) {
    const id = await subscriptionIn(status);
    const res = await act(id, "resume");
    const { data: after } = await supabase.from("subscriptions").select("status").eq("id", id).single();

    if (status === "paused") continue;
    check(`resume is refused for a ${status} subscription`, res.status === 409, `HTTP ${res.status}`);
    check(`  and its status is untouched (${status})`, after.status === status, `became ${after.status}`);
  }

  const cancelled = await subscriptionIn("cancelled");
  const paused = await act(cancelled, "pause", { reason: "crafted request" });
  const { data: stillCancelled } = await supabase.from("subscriptions").select("status").eq("id", cancelled).single();
  check("pause is refused for a cancelled subscription", paused.status === 409, `HTTP ${paused.status}`);
  check("  and it stays cancelled", stillCancelled.status === "cancelled", stillCancelled.status);

  console.log("\nValid transitions still work\n");

  const active = await subscriptionIn("active");
  const p = await act(active, "pause", { reason: "Customer asked to pause for a month" });
  const { data: nowPaused } = await supabase.from("subscriptions").select("status").eq("id", active).single();
  check("an active subscription can be paused", p.status === 200 && nowPaused.status === "paused",
        `HTTP ${p.status}, status ${nowPaused.status}`);

  const r = await act(active, "resume");
  const { data: nowActive } = await supabase.from("subscriptions").select("status").eq("id", active).single();
  check("a paused subscription can be resumed", r.status === 200 && nowActive.status === "active",
        `HTTP ${r.status}, status ${nowActive.status}`);

  const again = await act(active, "resume");
  check("resuming an already-active subscription is refused", again.status === 409, `HTTP ${again.status}`);
} finally {
  for (const id of tenants) {
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  await supabase.from("audit_log").delete().eq("actor_id", admin.id).in("action", ["subscription.paused", "subscription.resumed"]);
}

console.log(failures === 0 ? "\nAll transition checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
