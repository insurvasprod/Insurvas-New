// SA-4.4 live verification. Run with: npm run verify:offers
//
// Uses local coupon rows rather than creating provider promo codes. The script verifies the
// campaign layer around SA-3.6 and removes every throwaway record in finally.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const stamp = Date.now();
const tenantIds = [];
const subscriptionIds = [];
const couponIds = [];
const offerIds = [];
const auditTargetIds = [];

async function sign(adminId, role) {
  const token = await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  return `insurvas_admin_session=${token}`;
}

async function makeSubscription(label) {
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: `Offer ${label} ${stamp}`, status: "active" })
    .select("id")
    .single();
  if (tenantError) throw new Error(`Could not create tenant: ${tenantError.message}`);
  tenantIds.push(tenant.id);

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("code", "pro")
    .eq("version", 1)
    .single();
  if (planError) throw new Error(`Could not find verification plan: ${planError.message}`);

  const { data: subscriptionId, error: assignError } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant.id,
    p_plan_id: plan.id,
    p_billing_cycle: "monthly",
    p_start: new Date().toISOString(),
  });
  if (assignError) throw new Error(`Could not assign verification subscription: ${assignError.message}`);
  subscriptionIds.push(subscriptionId);
  return { tenantId: tenant.id, subscriptionId };
}

async function makeCoupon(label, overrides = {}) {
  const { data, error } = await supabase
    .from("coupons")
    .insert({
      code: `OFFER${stamp}${label}`,
      discount_type: "percent",
      percent_off: 50,
      duration: "n_periods",
      duration_periods: 3,
      billing_cycle: "monthly",
      max_redemptions: null,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create verification coupon: ${error.message}`);
  couponIds.push(data.id);
  return data.id;
}

async function makeOffer(label, couponId, overrides = {}) {
  const { data, error } = await supabase
    .from("offers")
    .insert({
      name: `Offer verification ${label} ${stamp}`,
      coupon_id: couponId,
      auto_apply: true,
      eligible_plan_types: ["individual"],
      eligible_plan_ids: [],
      eligible_cycles: ["monthly"],
      new_customers_only: false,
      existing_customers_only: false,
      is_active: true,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create verification offer: ${error.message}`);
  offerIds.push(data.id);
  return data.id;
}

async function cleanup() {
  if (auditTargetIds.length > 0) await supabase.from("audit_log").delete().in("target_id", auditTargetIds);
  if (subscriptionIds.length > 0) await supabase.from("subscription_coupons").delete().in("subscription_id", subscriptionIds);
  if (offerIds.length > 0) await supabase.from("offers").delete().in("id", offerIds);
  if (couponIds.length > 0) await supabase.from("coupons").delete().in("id", couponIds);
  if (tenantIds.length > 0) {
    await supabase.from("tenant_entitlements").delete().in("tenant_id", tenantIds);
    await supabase.from("subscriptions").delete().in("id", subscriptionIds);
    await supabase.from("tenants").delete().in("id", tenantIds);
  }
}

async function run() {
  const { error: tableError } = await supabase.from("offers").select("id").limit(1);
  if (tableError?.message?.includes("Could not find the table")) {
    console.log("NOT TESTABLE YET — apply supabase/migrations/0002_offers.sql first.");
    return 2;
  }
  if (tableError) throw new Error(`Offers table could not be read: ${tableError.message}`);

  try {
  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1)
    .single();
  if (adminError) throw new Error(`Could not find a super admin: ${adminError.message}`);

  console.log("Auto apply, cap, and duration\n");
  const coupon = await makeCoupon("A", { max_redemptions: 1 });
  const offer = await makeOffer("cap", coupon, { max_redemptions: 1 });
  const first = await makeSubscription("first");
  const second = await makeSubscription("second");

  const firstApply = await supabase.rpc("apply_auto_offer_to_subscription", { p_subscription_id: first.subscriptionId });
  check("a qualifying new subscription receives the auto offer", firstApply.data === offer, String(firstApply.data));
  const secondApply = await supabase.rpc("apply_auto_offer_to_subscription", { p_subscription_id: second.subscriptionId });
  check("the redemption cap is enforced at apply time", secondApply.data === null, String(secondApply.data));
  const { data: count } = await supabase.from("offers").select("redeemed_count").eq("id", offer).single();
  check("the rejected application does not consume capacity", count?.redeemed_count === 1, String(count?.redeemed_count));

  const durationCoupon = await makeCoupon("B");
  const durationOffer = await makeOffer("duration", durationCoupon);
  const durationSub = await makeSubscription("duration");
  const durationApply = await supabase.rpc("apply_auto_offer_to_subscription", { p_subscription_id: durationSub.subscriptionId });
  check("a three-period offer applies", durationApply.data === durationOffer, String(durationApply.data));
  const remaining = [];
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase.rpc("consume_coupon_period", { p_subscription_id: durationSub.subscriptionId });
    remaining.push(data);
  }
  check("three invoices are discounted, then the offer expires", remaining.join(",") === "2,1,0,-1", remaining.join(","));

  const { error: disableTestOffersError } = await supabase
    .from("offers")
    .update({ auto_apply: false })
    .in("id", [offer, durationOffer]);
  if (disableTestOffersError) throw new Error(`Could not isolate end-date check: ${disableTestOffersError.message}`);

  console.log("\nEnd date and audited edit\n");
  const endedCoupon = await makeCoupon("C");
  await makeOffer("ended", endedCoupon, { ends_at: "2020-01-01T00:00:00Z" });
  const endedSub = await makeSubscription("ended");
  const endedApply = await supabase.rpc("apply_auto_offer_to_subscription", { p_subscription_id: endedSub.subscriptionId });
  check("an offer past its end date stops auto-applying", endedApply.data === null, String(endedApply.data));

  const editId = durationOffer;
  auditTargetIds.push(editId);
  const cookie = await sign(admin.id, admin.role);
  const { data: directEditOffer } = await supabase.from("offers").select("id").eq("id", editId).maybeSingle();
  check("the offer remains readable before the API edit", directEditOffer?.id === editId, String(directEditOffer?.id));
  const listResponse = await fetch(`${BASE}/api/admin/offers`, { headers: { cookie } });
  const listBody = await listResponse.text();
  check("the offer is visible through the admin API", listResponse.status === 200 && listBody.includes(editId), `status ${listResponse.status}`);
  const response = await fetch(`${BASE}/api/admin/offers/${editId}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: `Edited offer ${stamp}` }),
  });
  const responseBody = await response.text();
  check("editing an offer succeeds through the admin API", response.status === 200, `status ${response.status}: ${responseBody}`);
  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("id")
    .eq("action", "offer.updated")
    .eq("target_id", editId);
  check("editing an offer is audit-logged", (auditRows ?? []).length > 0, String(auditRows?.length ?? 0));
} finally {
  await cleanup();
  }

  if (failures > 0) return 1;
  console.log("\nAll live offer checks passed.");
  return 0;
}

const exitCode = await run().catch((error) => {
  console.error(error);
  return 1;
});
process.exitCode = exitCode;
