// SA-3.7 acceptance: custom invoices and manual billing.
//
// The settle-and-activate path runs through the real HTTP route with a minted admin session, not
// by calling the database directly — it is the first time an invoice has been paid through the API,
// which is what backlog #40 was open for.
//
// Needs the app running. Everything is under a throwaway tenant and removed. Run: npm run verify:custom
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const YEAR = new Date().getUTCFullYear();
const MONTH = new Date().getUTCMonth() + 1;
const { data: counterBefore } = await supabase
  .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
const startingNumber = counterBefore?.next_number ?? null;

const { data: admin } = await supabase
  .from("admin_users").select("id, role").eq("role", "super_admin").eq("is_active", true).limit(1).single();
const token = await new SignJWT({ role: admin.role, stage: "authenticated" })
  .setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("10m")
  .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
const cookie = `insurvas_admin_session=${token}`;

const { data: tenant } = await supabase
  .from("tenants").insert({ name: `Custom invoice ${stamp}`, status: "active" }).select("id").single();
const tenantId = tenant.id;
const { data: plan } = await supabase.from("plans").select("id").eq("code", "basic").eq("version", 1).single();
await supabase.rpc("admin_assign_subscription", {
  p_tenant_id: tenantId, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString(),
});
const { data: sub } = await supabase.from("subscriptions").select("id").eq("tenant_id", tenantId).single();

async function cleanup() {
  await supabase.from("payments").delete().eq("tenant_id", tenantId);
  await supabase.from("invoices").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
  if (startingNumber === null) {
    await supabase.from("invoice_counters").delete().eq("year", YEAR).eq("month", MONTH);
  } else {
    await supabase.from("invoice_counters").update({ next_number: startingNumber }).eq("year", YEAR).eq("month", MONTH);
  }
}

const custom = (body) =>
  fetch(`${BASE}/api/admin/invoices/custom`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

try {
  console.log("Validation\n");

  const noReason = await custom({ tenant_id: tenantId, reason: "x", lines: [{ label: "A", amount: "10.00" }] });
  check("a custom invoice without a proper reason is refused", noReason.status === 400, String(noReason.status));

  const noLines = await custom({ tenant_id: tenantId, reason: "Agreed migration fee", lines: [] });
  check("a custom invoice with no lines is refused", noLines.status === 400, String(noLines.status));

  console.log("\nNumbering and state\n");

  // An automatic invoice first, so the two kinds interleave and the sequence can be checked.
  const { data: autoRows } = await supabase.rpc("create_invoice_for_payment", {
    p_tenant_id: tenantId, p_subscription_id: sub.id, p_provider: "whop",
    p_provider_payment_id: `pay_custom_${stamp}`, p_provider_total_cents: 9900,
    p_period_start: new Date().toISOString(), p_period_end: new Date().toISOString(),
    p_paid_at: new Date().toISOString(),
    p_lines: [{ kind: "plan", label: "Plan A monthly", quantity: 1, unit_cents: 9900, amount_cents: 9900 }],
  });
  const automatic = autoRows[0];

  const created = await custom({
    tenant_id: tenantId,
    subscription_id: sub.id,
    reason: "Agreed data migration fee, contract of 14 August",
    due_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    lines: [{ label: "Data migration", amount: "500.00" }, { label: "Training", amount: "250.00" }],
  });
  const body = await created.json();
  check("a custom invoice is created", created.status === 201, JSON.stringify(body).slice(0, 160));

  check(
    "it takes the NEXT number from the same sequence as the automatic one",
    Number(body.number?.slice(-4)) === Number(automatic.number.slice(-4)) + 1,
    `${automatic.number} then ${body.number}`,
  );
  check("the lines are summed", body.totalCents === 75000, String(body.totalCents));

  const { data: inv } = await supabase
    .from("invoices").select("status, kind, reason, total_cents, created_by").eq("id", body.invoiceId).single();
  check("it is born ISSUED, not paid", inv.status === "issued", inv.status);
  check("it is marked as a custom invoice", inv.kind === "custom");
  check("the reason is stored on the invoice", (inv.reason ?? "").includes("migration"));
  check("the admin who raised it is recorded", inv.created_by === admin.id);

  console.log("\nOverdue\n");

  await supabase.rpc("mark_overdue_invoices");
  const { data: afterSweep } = await supabase.from("invoices").select("status").eq("id", body.invoiceId).single();
  check(
    "an invoice past its due date becomes overdue",
    afterSweep.status === "overdue",
    `${afterSweep.status} — manual-billing tenants have no provider dunning, so this sweep is their only overdue signal`,
  );

  console.log("\nSettling it through the API\n");

  await supabase.from("subscriptions").update({ status: "suspended" }).eq("id", sub.id);

  const paid = await fetch(`${BASE}/api/admin/invoices/${body.invoiceId}/mark-paid`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ amount: "750.00", reference: `FT${stamp}` }),
  });
  const paidBody = await paid.json();
  check("the invoice can be settled by bank transfer", paid.status === 200, JSON.stringify(paidBody).slice(0, 160));
  check("it is recorded as settled in full", paidBody.settled === true && paidBody.remainingCents === 0);

  const { data: settled } = await supabase.from("invoices").select("status").eq("id", body.invoiceId).single();
  check("the invoice becomes paid", settled.status === "paid", settled.status);

  const { data: reactivated } = await supabase.from("subscriptions").select("status").eq("id", sub.id).single();
  check(
    "paying a linked custom invoice activates the subscription",
    reactivated.status === "active",
    `${reactivated.status} — the ticket's second criterion`,
  );

  const duplicate = await fetch(`${BASE}/api/admin/invoices/${body.invoiceId}/mark-paid`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ amount: "750.00", reference: `FT${stamp}` }),
  });
  check("the same invoice cannot be paid twice", duplicate.status === 409, String(duplicate.status));

  const { data: auditRows } = await supabase
    .from("audit_log").select("action").eq("target_id", body.invoiceId).order("ts");
  const actions = (auditRows ?? []).map((a) => a.action);
  check(
    "raising and settling are both audit-logged",
    actions.includes("invoice.custom_created") && actions.includes("payment.recorded_manually"),
    actions.join(", "),
  );
} finally {
  console.log("\nCleaning up…");
  await cleanup();
  const { data: restored } = await supabase
    .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
  check("the invoice counter is restored", (restored?.next_number ?? null) === startingNumber,
        `was ${startingNumber}, now ${restored?.next_number ?? null}`);
}

console.log(failures === 0 ? "\nAll custom invoice checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
