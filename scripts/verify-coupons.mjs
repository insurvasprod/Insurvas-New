// SA-3.6 acceptance, against the real database.
//
// The redemption cap and the "three invoices then it stops" behaviour are enforced in SQL, so they
// are checked there rather than through the UI. Creating the Whop promo is exercised separately by
// the admin route; this covers what happens after.
//
// Everything is created under throwaway tenants and removed. Run with: npm run verify:coupons
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const tenantIds = [];
const couponIds = [];

// This script creates an invoice, which consumes a number. Without restoring the counter it would
// leave a hole in the live sequence — breaking the very no-gaps guarantee SA-3.2 exists to give.
const YEAR = new Date().getUTCFullYear();
const MONTH = new Date().getUTCMonth() + 1;
const { data: counterBefore } = await supabase
  .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
const startingNumber = counterBefore?.next_number ?? null;

async function makeSubscription(label) {
  const { data: tenant } = await supabase
    .from("tenants").insert({ name: `Coupon ${label} ${stamp}`, status: "active" }).select("id").single();
  tenantIds.push(tenant.id);
  const { data: plan } = await supabase
    .from("plans").select("id").eq("code", "plan_b").eq("version", 1).single();
  await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant.id, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString(),
  });
  const { data: sub } = await supabase.from("subscriptions").select("id").eq("tenant_id", tenant.id).single();
  return { tenantId: tenant.id, subscriptionId: sub.id };
}

async function makeCoupon(overrides = {}) {
  const { data } = await supabase
    .from("coupons")
    .insert({
      code: `TEST${stamp}${couponIds.length}`,
      discount_type: "percent",
      percent_off: 50,
      duration: "n_periods",
      duration_periods: 3,
      billing_cycle: "monthly",
      ...overrides,
    })
    .select("id")
    .single();
  couponIds.push(data.id);
  return data.id;
}

async function cleanup() {
  for (const id of tenantIds) {
    await supabase.from("invoices").delete().eq("tenant_id", id);
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  await supabase.from("coupons").delete().in("id", couponIds);

  if (startingNumber === null) {
    await supabase.from("invoice_counters").delete().eq("year", YEAR).eq("month", MONTH);
  } else {
    await supabase.from("invoice_counters").update({ next_number: startingNumber }).eq("year", YEAR).eq("month", MONTH);
  }
  const { data: restored } = await supabase
    .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
  check("the invoice counter is restored, leaving no gap in the live sequence",
        (restored?.next_number ?? null) === startingNumber,
        `was ${startingNumber}, now ${restored?.next_number ?? null}`);
}

try {
  console.log("Redemption limit\n");

  const capped = await makeCoupon({ max_redemptions: 2 });
  const a = await makeSubscription("A");
  const b = await makeSubscription("B");
  const c = await makeSubscription("C");

  const r1 = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: a.subscriptionId, p_coupon_id: capped, p_applied_by: null,
  });
  check("the first redemption is allowed", r1.data === "ok", String(r1.data));

  const again = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: a.subscriptionId, p_coupon_id: capped, p_applied_by: null,
  });
  check("a second coupon on the same subscription is rejected", again.data === "already_has_coupon", String(again.data));

  const r2 = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: b.subscriptionId, p_coupon_id: capped, p_applied_by: null,
  });
  check("the second redemption is allowed", r2.data === "ok", String(r2.data));

  const r3 = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: c.subscriptionId, p_coupon_id: capped, p_applied_by: null,
  });
  check(
    "the redemption AFTER the cap is rejected as exhausted",
    r3.data === "exhausted",
    `got ${r3.data} — this is the ticket's 101st-redemption criterion at n=2`,
  );

  const { data: after } = await supabase.from("coupons").select("redeemed_count").eq("id", capped).single();
  check("the rejected attempt did not consume a slot", after.redeemed_count === 2, String(after.redeemed_count));

  console.log("\nDuration — three periods, then it stops on its own\n");

  const d = await makeSubscription("D");
  const threePeriods = await makeCoupon({ max_redemptions: null });
  await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: d.subscriptionId, p_coupon_id: threePeriods, p_applied_by: null,
  });

  const remaining = [];
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase.rpc("consume_coupon_period", { p_subscription_id: d.subscriptionId });
    remaining.push(data);
  }

  check("three periods are consumed then the coupon is gone",
        remaining[0] === 2 && remaining[1] === 1 && remaining[2] === 0 && remaining[3] === -1,
        `sequence was ${remaining.join(", ")} (expected 2, 1, 0, -1)`);

  const { data: application } = await supabase
    .from("subscription_coupons").select("is_active, periods_remaining")
    .eq("subscription_id", d.subscriptionId).single();
  check("the application deactivates itself without a scheduled job",
        application.is_active === false && application.periods_remaining === 0,
        JSON.stringify(application));

  console.log("\nExpiry\n");

  const e = await makeSubscription("E");
  const expired = await makeCoupon({ expires_at: "2020-01-01T00:00:00Z" });
  const r4 = await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: e.subscriptionId, p_coupon_id: expired, p_applied_by: null,
  });
  check("an expired coupon is rejected", r4.data === "expired", String(r4.data));

  console.log("\nDiscount on the invoice\n");

  const f = await makeSubscription("F");
  const halfOff = await makeCoupon({ max_redemptions: null, duration: "forever", duration_periods: null });
  await supabase.rpc("admin_apply_coupon", {
    p_subscription_id: f.subscriptionId, p_coupon_id: halfOff, p_applied_by: null,
  });

  // Plan B is $249; 50% off means the provider charges $124.50 and our lines must say the same.
  const { data: invoiceRows } = await supabase.rpc("create_invoice_for_payment", {
    p_tenant_id: f.tenantId,
    p_subscription_id: f.subscriptionId,
    p_provider: "whop",
    p_provider_payment_id: `pay_coupon_${stamp}`,
    p_provider_total_cents: 12450,
    p_period_start: new Date().toISOString(),
    p_period_end: new Date().toISOString(),
    p_paid_at: new Date().toISOString(),
    p_lines: [
      { kind: "plan", label: "Plan B monthly", quantity: 1, unit_cents: 24900, amount_cents: 24900 },
      { kind: "discount", label: "Coupon TEST", quantity: 1, unit_cents: 12450, amount_cents: 12450 },
    ],
  });
  const invoice = invoiceRows[0];

  const { data: inv } = await supabase
    .from("invoices").select("subtotal_cents, discount_cents, tax_cents, total_cents, reconciliation")
    .eq("id", invoice.invoice_id).single();

  check("the discount is a separate line, not folded into the plan price",
        inv.subtotal_cents === 24900 && inv.discount_cents === 12450, JSON.stringify(inv));
  check("the total is subtotal minus discount", inv.total_cents === 12450, String(inv.total_cents));
  check("the discount is applied before tax", inv.tax_cents === 0 && inv.total_cents === inv.subtotal_cents - inv.discount_cents);
  check("a discounted invoice still reconciles against the provider",
        inv.reconciliation === "matched",
        "if this is mismatched, our discount and Whop's promo disagree");
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll coupon checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
