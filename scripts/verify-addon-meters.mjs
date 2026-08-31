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
// Everything is created and removed. Run: npm run verify:addon-meters
import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let fail = 0;
const check = (l, c, d = "") => { console.log(c ? `  ok   ${l}` : `  FAIL ${l}${d ? " — " + d : ""}`); if (!c) fail++; };

const { data: plan } = await s.from("plans").select("id").eq("code","basic").order("version",{ascending:false}).limit(1).single();
const { data: t } = await s.from("tenants").insert({ name: `M2-3 ${stamp}`, status: "active" }).select("id").single();
const { data: sub } = await s.from("subscriptions").insert({
  tenant_id: t.id, plan_id: plan.id, status: "active", billing_cycle: "monthly",
  started_at: new Date().toISOString(), current_period_start: new Date().toISOString(),
  current_period_end: new Date(Date.now()+30*86400000).toISOString(),
}).select("id").single();

// Give the plan a finite allowance for a meter we control.
const METER = "dialer_minutes";
await s.from("plan_meters").upsert({ plan_id: plan.id, meter_key: METER, included_qty: 1000, hard_cap: true }, { onConflict: "plan_id,meter_key" });

const before = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("plan allowance alone is enforced", before.data?.[0]?.included === 1000, JSON.stringify(before.data?.[0]));

// Attach an add-on carrying 500 more.
const { data: addon } = await s.from("addons").insert({ code: `m23_${stamp}`, name: `M2-3 addon ${stamp}`, price_cents: 0, is_active: true }).select("id").single();
await s.from("addon_meters").insert({ addon_id: addon.id, meter_key: METER, included_qty: 500 });
const { data: sa } = await s.from("subscription_addons").insert({ subscription_id: sub.id, addon_id: addon.id }).select("id").single();

const after = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("an attached add-on's credits reach enforcement", after.data?.[0]?.included === 1500,
      `included=${after.data?.[0]?.included}, expected 1500 (1000 plan + 500 add-on)`);

const resolved = await s.rpc("resolve_tenant_entitlement", { p_tenant_id: t.id });
check("enforcement agrees with the entitlement resolver",
      resolved.data?.[0]?.meter_allowances?.[METER]?.included === after.data?.[0]?.included,
      `resolver=${resolved.data?.[0]?.meter_allowances?.[METER]?.included} enforcement=${after.data?.[0]?.included}`);

// Detaching must remove them again.
await s.from("subscription_addons").update({ detached_at: new Date().toISOString() }).eq("id", sa.id);
const detached = await s.rpc("check_meter_capacity", { p_tenant_id: t.id, p_meter_key: METER, p_qty: 1 });
check("detaching the add-on removes its credits", detached.data?.[0]?.included === 1000, `included=${detached.data?.[0]?.included}`);

await s.from("subscription_addons").delete().eq("subscription_id", sub.id);
await s.from("addon_meters").delete().eq("addon_id", addon.id);
await s.from("addons").delete().eq("id", addon.id);
await s.from("plan_meters").delete().eq("plan_id", plan.id).eq("meter_key", METER);
await s.from("subscriptions").delete().eq("tenant_id", t.id);
await s.from("tenant_entitlements").delete().eq("tenant_id", t.id);
await s.from("tenants").delete().eq("id", t.id);
console.log(fail === 0 ? "\nM2-3 OK" : `\n${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
