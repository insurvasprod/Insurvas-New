import "./lib/refuseProduction.mjs";
// bugs_sa.md M2-3 · Add-on meter credits must reach ENFORCEMENT, not just the entitlement blob.
//
// resolve_tenant_entitlement always stacked plan and add-on credits. check_meter_capacity — the
// function that actually decides whether an action is allowed — read only plan_meters, so a tenant
// who bought a 500-minute add-on on top of a 1,000-minute plan was still blocked at 1,000. They
// paid for credits enforcement could not see.
//
// The third assertion is the one that matters most: the two must produce the SAME number. An
// allowance a customer is shown and an allowance they are held to cannot come from two different
// pieces of arithmetic.
//
// Fixtures are strictly namespaced. Catalog/history rows are archived or detached during cleanup;
// a pre-existing plan meter is restored byte-for-byte rather than blindly deleted. Run:
// npm run verify:addon-meters
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let fail = 0;
const check = (l, c, d = "") => { console.log(c ? `  ok   ${l}` : `  FAIL ${l}${d ? " — " + d : ""}`); if (!c) fail++; };
const must = (label, result) => {
  if (result.error) {
    check(label, false, result.error.message);
    return null;
  }
  return result.data;
};

const plan = must("basic plan lookup", await s.from("plans").select("id").eq("code","basic").order("version",{ascending:false}).limit(1).single());
if (!plan) process.exit(1);
const originalPlanMeter = (await s.from("plan_meters").select("plan_id, meter_key, included_qty, hard_cap").eq("plan_id", plan.id).eq("meter_key", "dialer_minutes").maybeSingle()).data;
const t = must("create namespaced tenant fixture", await s.from("tenants").insert({ name: `M2-3 ${stamp}`, status: "active" }).select("id").single());
if (!t) process.exit(1);
const sub = must("create namespaced subscription fixture", await s.from("subscriptions").insert({
  tenant_id: t.id, plan_id: plan.id, status: "active", billing_cycle: "monthly",
  started_at: new Date().toISOString(), current_period_start: new Date().toISOString(),
  current_period_end: new Date(Date.now()+30*86400000).toISOString(),
}).select("id").single());
if (!sub) process.exit(1);

// Give the plan a finite allowance for a meter we control.
const METER = "dialer_minutes";
must("set disposable plan meter", await s.from("plan_meters").upsert({ plan_id: plan.id, meter_key: METER, included_qty: 1000, hard_cap: true }, { onConflict: "plan_id,meter_key" }));

const before = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("plan allowance alone is enforced", before.data?.[0]?.included === 1000, JSON.stringify(before.data?.[0]));

// Attach an add-on carrying 500 more.
const addon = must("create namespaced add-on fixture", await s.from("addons").insert({ code: `m23_${stamp}`, name: `M2-3 addon ${stamp}`, price_cents: 0, is_active: true }).select("id").single());
if (!addon) process.exit(1);
must("configure add-on meter fixture", await s.from("addon_meters").insert({ addon_id: addon.id, meter_key: METER, included_qty: 500 }));
const sa = must("attach add-on fixture", await s.from("subscription_addons").insert({ subscription_id: sub.id, addon_id: addon.id }).select("id").single());
if (!sa) process.exit(1);

const after = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("an attached add-on's credits reach enforcement", after.data?.[0]?.included === 1500,
      `included=${after.data?.[0]?.included}, expected 1500 (1000 plan + 500 add-on)`);

const resolved = await s.rpc("resolve_tenant_entitlement", { p_tenant_id: t.id });
check("enforcement agrees with the entitlement resolver",
      resolved.data?.[0]?.meter_allowances?.[METER]?.included === after.data?.[0]?.included,
      `resolver=${resolved.data?.[0]?.meter_allowances?.[METER]?.included} enforcement=${after.data?.[0]?.included}`);

// Detaching must remove them again.
must("detach add-on fixture", await s.from("subscription_addons").update({ detached_at: new Date().toISOString() }).eq("id", sa.id));
const detached = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("detaching the add-on removes its credits", detached.data?.[0]?.included === 1000, `included=${detached.data?.[0]?.included}`);

// Cleanup is deliberately non-destructive for history-bearing records.
must("archive add-on fixture", await s.from("addons").update({ is_active: false }).eq("id", addon.id));
must("cancel subscription fixture", await s.from("subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "M2-3 verification cleanup" }).eq("id", sub.id));
must("suspend tenant fixture", await s.from("tenants").update({ status: "suspended" }).eq("id", t.id));
must("remove disposable add-on meter", await s.from("addon_meters").delete().eq("addon_id", addon.id));
if (originalPlanMeter) {
  must("restore existing plan meter", await s.from("plan_meters").upsert(originalPlanMeter, { onConflict: "plan_id,meter_key" }));
} else {
  must("remove disposable plan meter", await s.from("plan_meters").delete().eq("plan_id", plan.id).eq("meter_key", METER));
}
console.log(fail === 0 ? "\nM2-3 OK" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
