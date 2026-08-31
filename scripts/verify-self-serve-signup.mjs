import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase service environment");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `sa51-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
let userId;
let tenantId;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function cleanup() {
  if (!userId || !tenantId) return;
  await supabase.from("business_profiles").delete().eq("tenant_id", tenantId);
  await supabase.from("signup_selections").delete().eq("tenant_id", tenantId);
  await supabase.from("user_invitations").delete().eq("user_id", userId);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  await supabase.from("users").delete().eq("id", userId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

try {
  const { data: plans, error: planError } = await supabase
    .from("admin_plan_list")
    .select("id, code, is_public, is_archived")
    .eq("is_public", true)
    .eq("is_archived", false)
    .limit(1);
  if (planError) throw planError;
  assert.ok(plans?.[0], "A public plan is required for verification");

  const plan = plans[0];
  const { data: prices, error: priceError } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents")
    .eq("plan_id", plan.id)
    .single();
  if (priceError) throw priceError;
  const cycle = prices.price_monthly_cents != null ? "monthly" : prices.price_quarterly_cents != null ? "quarterly" : "yearly";

  const token = randomBytes(32).toString("base64url");
  const { data: created, error: signupError } = await supabase.rpc("self_serve_signup", {
    p_name: "SA 5.1 Verification",
    p_email: email,
    p_password_hash: await bcrypt.hash("correct horse battery staple", 12),
    p_phone: "+1 555 555 0199",
    p_plan_id: plan.id,
    p_billing_cycle: cycle,
    p_token_hash: tokenHash(token),
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (signupError) throw signupError;
  userId = created[0].user_id;
  tenantId = created[0].tenant_id;

  const [{ data: user }, { data: tenant }, { data: member }, { data: selection }] = await Promise.all([
    supabase.from("users").select("status").eq("id", userId).single(),
    supabase.from("tenants").select("status, onboarding_state").eq("id", tenantId).single(),
    supabase.from("tenant_users").select("role").eq("user_id", userId).single(),
    supabase.from("signup_selections").select("plan_id, billing_cycle").eq("tenant_id", tenantId).single(),
  ]);
  assert.equal(user.status, "pending_verification");
  assert.deepEqual(tenant, { status: "provisioning", onboarding_state: "pending_verification" });
  assert.equal(member.role, "owner");
  assert.deepEqual(selection, { plan_id: plan.id, billing_cycle: cycle });

  const duplicateToken = randomBytes(32).toString("base64url");
  const { error: duplicateError } = await supabase.rpc("self_serve_signup", {
    p_name: "Duplicate",
    p_email: email.toUpperCase(),
    p_password_hash: await bcrypt.hash("another secure password", 12),
    p_phone: "+1 555 555 0200",
    p_plan_id: plan.id,
    p_billing_cycle: cycle,
    p_token_hash: tokenHash(duplicateToken),
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(duplicateError?.code, "23505", "case-variant duplicate email must fail");

  const { data: matchingUsers } = await supabase.from("users").select("id").ilike("email", email);
  assert.equal(matchingUsers.length, 1, "duplicate failure creates no second user");

  const { data: verified, error: verifyError } = await supabase.rpc("complete_signup_email_verification", {
    p_token_hash: tokenHash(token),
  });
  if (verifyError) throw verifyError;
  assert.equal(verified[0].user_id, userId);

  const { data: afterVerify } = await supabase.from("tenants").select("onboarding_state").eq("id", tenantId).single();
  assert.equal(afterVerify.onboarding_state, "business_profile");

  const { error: profileError } = await supabase.rpc("save_signup_business_profile", {
    p_user_id: userId,
    p_business_name: "SA 5.1 Test Agency",
    p_npn: "0012345678",
    p_primary_state: "TX",
    p_products_sold: ["life"],
    p_monthly_volume_range: "26_100",
    p_lead_sources: ["referrals"],
    p_lead_source_other: "",
    p_recommended_setup_steps: ["Configure your product workspace"],
  });
  if (profileError) throw profileError;

  const { data: finished } = await supabase.from("tenants").select("name, onboarding_state").eq("id", tenantId).single();
  assert.deepEqual(finished, { name: "SA 5.1 Test Agency", onboarding_state: "ready_for_checkout" });
  console.log("SA-5.1 live verification passed: atomic signup, duplicate rollback, verification, and profile progression.");
} finally {
  await cleanup();
}
