// SA-3.1 · Create the Whop plan that sells one of our plan versions, and record the mapping.
//
// This is the outbound half meeting reality: the request shape was written from Whop's API
// reference, never against the live sandbox. Run it for one plan first.
//
// Usage: npm run whop:sync-plan -- <plan_code> <monthly|quarterly|yearly> [--checkout <tenant_id>]
import { createClient } from "@supabase/supabase-js";
import { WhopClient } from "../lib/payments/whop/client.ts";
import { WhopProvider } from "../lib/payments/whop/provider.ts";

const [planCode, billingCycle] = process.argv.slice(2);
const checkoutFlagIndex = process.argv.indexOf("--checkout");
const checkoutTenantId = checkoutFlagIndex > -1 ? process.argv[checkoutFlagIndex + 1] : null;

if (!planCode || !billingCycle) {
  console.error("Usage: npm run whop:sync-plan -- <plan_code> <monthly|quarterly|yearly> [--checkout <tenant_id>]");
  process.exit(1);
}

const PRICE_COLUMN = {
  monthly: "price_monthly_cents",
  quarterly: "price_quarterly_cents",
  yearly: "price_yearly_cents",
};

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Latest version of the plan — the one currently on sale.
const { data: plan } = await supabase
  .from("plans")
  .select("id, code, version, name")
  .eq("code", planCode)
  .eq("is_archived", false)
  .order("version", { ascending: false })
  .limit(1)
  .maybeSingle();

if (!plan) {
  console.error(`No unarchived plan with code "${planCode}"`);
  process.exit(1);
}

const { data: prices } = await supabase
  .from("plan_prices")
  .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents")
  .eq("plan_id", plan.id)
  .maybeSingle();

const priceCents = prices?.[PRICE_COLUMN[billingCycle]] ?? null;
if (priceCents === null) {
  console.error(`${plan.code} v${plan.version} does not offer ${billingCycle} billing`);
  process.exit(1);
}

console.log(`${plan.name} (${plan.code} v${plan.version}) ${billingCycle} = ${priceCents} cents`);

const { data: existing } = await supabase
  .from("whop_plans")
  .select("whop_plan_id, price_cents")
  .eq("plan_id", plan.id)
  .eq("billing_cycle", billingCycle)
  .maybeSingle();

const provider = new WhopProvider(
  new WhopClient({ apiKey: process.env.WHOP_API_KEY, baseUrl: process.env.WHOP_API_BASE_URL }),
);

let whopPlanId;
if (existing) {
  whopPlanId = existing.whop_plan_id;
  console.log(`Already mapped -> ${whopPlanId}${existing.price_cents !== priceCents ? "  ** PRICE DRIFT **" : ""}`);
} else {
  const created = await provider.createPlan({
    productId: process.env.WHOP_PRODUCT_ID,
    accountId: process.env.WHOP_ACCOUNT_ID,
    priceCents,
    billingCycle,
    ourPlanId: plan.id,
    planCode: plan.code,
    planVersion: plan.version,
  });
  whopPlanId = created.whopPlanId;
  console.log(`Created Whop plan -> ${whopPlanId}`);
  if (created.purchaseUrl) console.log(`  purchase_url: ${created.purchaseUrl}`);

  const { error } = await supabase.from("whop_plans").insert({
    plan_id: plan.id,
    billing_cycle: billingCycle,
    whop_plan_id: whopPlanId,
    whop_product_id: created.productId,
    price_cents: priceCents,
  });
  if (error) {
    console.error(`Whop plan created but the mapping was NOT recorded: ${error.message}`);
    process.exit(1);
  }
  console.log("Mapping recorded in whop_plans.");
}

if (checkoutTenantId) {
  const session = await provider.createCheckoutSession({
    providerPlanId: whopPlanId,
    tenantId: checkoutTenantId,
    metadata: { insurvas_plan_id: plan.id, insurvas_billing_cycle: billingCycle },
  });
  console.log(`\nCheckout URL (pay with 4242 4242 4242 4242):\n  ${session.url}`);
  console.log(`  session: ${session.id}`);
}
