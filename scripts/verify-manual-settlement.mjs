// bugs_sa.md M3-4 · Manual settlement must be atomic, targeted, and refuse overpayment.
//
// The route used to activate EVERY subscription belonging to the tenant, accept more than the
// outstanding balance, and perform four writes with the update errors ignored — so a partial
// failure left a recorded payment against an unpaid invoice, and the retry was then refused by the
// unique index on the bank reference. Money recorded, invoice unsettled, no way out from the UI.
//
// Drives the real admin route. Everything is removed. Run: npm run verify:settlement
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

const { data: plan } = await supabase.from("plans").select("id").eq("code", "plan_a").order("version", { ascending: false }).limit(1).single();

async function tenantWithTwoSubscriptions() {
  const { data: t } = await supabase.from("tenants").insert({ name: `M3-4 ${stamp}`, status: "active" }).select("id").single();
  tenants.push(t.id);
  const mk = (status) => supabase.from("subscriptions").insert({
    tenant_id: t.id, plan_id: plan.id, status, billing_cycle: "monthly",
    started_at: new Date().toISOString(), current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
  }).select("id").single();
  const { data: billed } = await mk("past_due");
  const { data: unrelated } = await mk("cancelled");
  return { tenantId: t.id, billed: billed.id, unrelated: unrelated.id };
}

const settle = (invoiceId, amount, reference) => fetch(`${BASE}/api/admin/invoices/${invoiceId}/mark-paid`, {
  method: "POST", headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ amount: String(amount / 100), reference }),
});

try {
  const { tenantId, billed, unrelated } = await tenantWithTwoSubscriptions();

  const { data: invRows } = await supabase.rpc("create_custom_invoice", {
    p_tenant_id: tenantId, p_subscription_id: billed,
    p_reason: "M3-4 settlement verification", p_due_at: new Date().toISOString(),
    p_created_by: admin.id,
    p_lines: [{ kind: "plan", label: "Verification", amount_cents: 10000 }],
  });
  const invoice = invRows[0];

  console.log("Overpayment\n");
  const over = await settle(invoice.invoice_id, 15000, `over-${stamp}`);
  check("more than the outstanding balance is refused", over.status === 409, `HTTP ${over.status}`);
  const { data: noPayments } = await supabase.from("payments").select("id").eq("invoice_id", invoice.invoice_id);
  check("  and nothing is recorded for the refused attempt", (noPayments ?? []).length === 0, `${noPayments?.length} payment(s)`);

  console.log("\nPartial then full settlement\n");
  const part = await settle(invoice.invoice_id, 4000, `part-${stamp}`);
  const partBody = await part.json();
  check("a partial payment is accepted", part.status === 200 && partBody.settled === false, JSON.stringify(partBody));

  const { data: stillOpen } = await supabase.from("invoices").select("status").eq("id", invoice.invoice_id).single();
  check("  and the invoice stays unpaid", stillOpen.status !== "paid", stillOpen.status);

  const rest = await settle(invoice.invoice_id, 6000, `rest-${stamp}`);
  const restBody = await rest.json();
  check("the balance settles the invoice", rest.status === 200 && restBody.settled === true, JSON.stringify(restBody));

  console.log("\nOnly the invoice's OWN subscription is touched\n");
  const { data: subs } = await supabase.from("subscriptions").select("id, status").eq("tenant_id", tenantId);
  const billedRow = subs.find((r) => r.id === billed);
  const unrelatedRow = subs.find((r) => r.id === unrelated);
  check("the invoice's own past_due subscription is activated", billedRow.status === "active", billedRow.status);
  check("the unrelated cancelled subscription is NOT revived", unrelatedRow.status === "cancelled", unrelatedRow.status);

  console.log("\nAtomicity\n");
  const dupe = await settle(invoice.invoice_id, 1000, `rest-${stamp}`);
  check("the invoice cannot be paid twice", dupe.status === 409, `HTTP ${dupe.status}`);

  const { data: finalPayments } = await supabase.from("payments").select("amount_cents").eq("invoice_id", invoice.invoice_id).eq("status", "succeeded");
  const total = (finalPayments ?? []).reduce((s, p) => s + p.amount_cents, 0);
  check("payments never exceed the invoice total", total === 10000, `${total} vs 10000`);
} finally {
  for (const id of tenants) {
    const { data: invs } = await supabase.from("invoices").select("id").eq("tenant_id", id);
    for (const i of invs ?? []) {
      await supabase.from("payments").delete().eq("invoice_id", i.id);
      await supabase.from("invoice_lines").delete().eq("invoice_id", i.id);
    }
    await supabase.from("invoices").delete().eq("tenant_id", id);
    await supabase.from("tenant_entitlements").delete().eq("tenant_id", id);
    await supabase.from("subscriptions").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  await supabase.from("audit_log").delete().eq("actor_id", admin.id).eq("action", "payment.recorded_manually");
}

console.log(failures === 0 ? "\nAll settlement checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
