// SA-2.8 acceptance: for each seeded plan, assert the EXACT feature list an agent on it gets,
// and that a suspended subscription yields a read-only entitlement rather than an empty one.
//
// Everything runs against a throwaway tenant inside the real database and is cleaned up at the
// end, so it can be run repeatedly without leaving residue.
//
// Run with: npm run verify:entitlements
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const stamp = Date.now();
const { data: tenant } = await supabase
  .from("tenants")
  .insert({ name: `Entitlement check ${stamp}`, status: "active" })
  .select("id")
  .single();

const tenantId = tenant.id;

async function cleanup() {
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

try {
  const { data: plans } = await supabase
    .from("plans")
    .select("id, code, version")
    .eq("version", 1)
    .in("code", ["basic", "pro", "advance"])
    .order("code");

  console.log("Exact feature list per seeded plan\n");

  for (const plan of plans ?? []) {
    // What the plan grants, straight from plan_features — the independent expectation.
    const { data: planFeatures } = await supabase
      .from("plan_features")
      .select("feature_key")
      .eq("plan_id", plan.id);
    const expected = (planFeatures ?? []).map((f) => f.feature_key).sort();

    await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
    const { error: assignError } = await supabase.rpc("admin_assign_subscription", {
      p_tenant_id: tenantId,
      p_plan_id: plan.id,
      p_billing_cycle: "monthly",
      p_start: new Date().toISOString(),
    });
    if (assignError) throw new Error(`assign failed for ${plan.code}: ${assignError.message}`);

    const { data: entitlement } = await supabase.rpc("refresh_tenant_entitlement", {
      p_tenant_id: tenantId,
    });

    const actual = [...(entitlement.features ?? [])].sort();

    check(
      `${plan.code}: ${expected.length} features, exact match`,
      JSON.stringify(actual) === JSON.stringify(expected),
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    check(`${plan.code}: plan_code stamped`, entitlement.plan_code === plan.code);
    check(`${plan.code}: access is full while active`, entitlement.access === "full");
  }

  // --- Suspended must be READ-ONLY, not empty --------------------------------
  console.log("\nSuspended subscription\n");

  await supabase.from("subscriptions").update({ status: "suspended" }).eq("tenant_id", tenantId);
  const { data: suspended } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });

  check("access is read_only", suspended.access === "read_only", `got ${suspended.access}`);
  check(
    "features are RETAINED, not emptied",
    (suspended.features ?? []).length > 0,
    `got ${(suspended.features ?? []).length} features — a suspended tenant must still see their book`,
  );

  // --- Cancelled yields nothing ---------------------------------------------
  console.log("\nCancelled subscription\n");

  await supabase.from("subscriptions").update({ status: "cancelled" }).eq("tenant_id", tenantId);
  const { data: cancelled } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });

  check("access is none", cancelled.access === "none", `got ${cancelled.access}`);
  check("no features", (cancelled.features ?? []).length === 0);
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll entitlement checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
