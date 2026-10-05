import "./lib/refuseProduction.mjs";
// SA-3.2 acceptance: an annual provider payment is reconciled through the live webhook path.
// This creates only a namespaced tenant and retains the resulting immutable invoice as QA history.
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const secret = process.env.WHOP_WEBHOOK_SECRET;
if (!secret) throw new Error("WHOP_WEBHOOK_SECRET is not configured");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const check = (label, condition, detail = "") => {
  console.log(condition ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
};

const stamp = Date.now();
const { data: plan, error: planError } = await supabase
  .from("plans")
  .select("id, name")
  .eq("code", "basic")
  .eq("version", 1)
  .single();
if (planError || !plan) throw new Error(`basic plan: ${planError?.message ?? "not found"}`);

const { data: prices, error: priceError } = await supabase
  .from("plan_prices")
  .select("price_yearly_cents")
  .eq("plan_id", plan.id)
  .single();
if (priceError || prices?.price_yearly_cents == null) {
  throw new Error(`basic yearly price: ${priceError?.message ?? "not configured"}`);
}

const { data: tenant, error: tenantError } = await supabase
  .from("tenants")
  .insert({ name: `Annual invoice verify ${stamp}`, status: "active" })
  .select("id")
  .single();
if (tenantError || !tenant) throw new Error(`tenant: ${tenantError?.message ?? "not created"}`);

async function cleanup() {
  await supabase.from("payments").delete().eq("tenant_id", tenant.id);
  await supabase.from("webhook_events").delete().like("event_id", `annual_${stamp}%`);
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenant.id);
  // Issued invoices are immutable financial history. Deactivate this namespaced fixture instead
  // of deleting it or rewinding the shared invoice counter.
  await supabase.from("subscriptions").update({ status: "cancelled" }).eq("tenant_id", tenant.id);
  await supabase.from("tenants").update({ status: "suspended" }).eq("id", tenant.id);
}

try {
  const { error: assignError } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenant.id,
    p_plan_id: plan.id,
    p_billing_cycle: "yearly",
    p_start: new Date().toISOString(),
  });
  if (assignError) throw new Error(`subscription: ${assignError.message}`);

  const eventId = `annual_${stamp}_payment`;
  const paymentId = `annual_pay_${stamp}`;
  const envelope = {
    id: eventId,
    type: "payment.succeeded",
    api_version: "v1",
    timestamp: new Date().toISOString(),
    data: {
      id: paymentId,
      total: (prices.price_yearly_cents / 100).toFixed(2),
      paid_at: new Date().toISOString(),
      metadata: { tenant_id: tenant.id },
      billing_reason: "subscription_create",
      plan: { id: "annual_plan", metadata: { insurvas_plan_id: plan.id, insurvas_billing_cycle: "yearly" } },
    },
  };
  const body = JSON.stringify(envelope);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${eventId}.${timestamp}.${body}`).digest("base64");
  const response = await fetch(`${BASE}/api/webhooks/whop`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
  const result = await response.json();
  check("annual payment is accepted by the signed webhook", response.status === 200, JSON.stringify(result));

  const { data: invoice } = await supabase
    .from("platform_invoices")
    .select("number, status, total_cents, provider_payment_id")
    .eq("tenant_id", tenant.id)
    .eq("provider_payment_id", paymentId)
    .single();
  check("annual invoice is created", Boolean(invoice));
  check("annual invoice is paid", invoice?.status === "paid", invoice?.status ?? "missing");
  check("annual price is reconciled in cents", invoice?.total_cents === prices.price_yearly_cents,
    `${invoice?.total_cents} vs ${prices.price_yearly_cents}`);
  check("annual provider payment id is retained", invoice?.provider_payment_id === paymentId);

  const { data: sub } = await supabase.from("subscriptions").select("billing_cycle, status").eq("tenant_id", tenant.id).single();
  check("subscription keeps the annual billing cycle", sub?.billing_cycle === "yearly", sub?.billing_cycle ?? "missing");
  check("successful annual payment leaves subscription active", sub?.status === "active", sub?.status ?? "missing");
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nAll annual invoice checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
