// SA-3.2 acceptance, against the real database with the client the app uses.
//
// The immutability checks matter most: they run as service_role, so they prove the RUNNING
// APPLICATION cannot rewrite an issued invoice — not merely that a REVOKE was typed once.
//
// Restores the invoice counter afterwards, so running this never burns a number out of the live
// sequence. Run with: npm run verify:invoices
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = now.getUTCMonth() + 1;
const stamp = Date.now();

const { data: before } = await supabase
  .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
const counterBefore = before?.next_number ?? null;

const { data: tenant } = await supabase
  .from("tenants").insert({ name: `Invoice check ${stamp}`, status: "active" }).select("id").single();
const tenantId = tenant.id;

const planLine = (cents) => [{ kind: "plan", label: "Plan B monthly", quantity: 1, unit_cents: cents, amount_cents: cents }];
const call = (paymentId, providerCents, lines) =>
  supabase.rpc("create_invoice_for_payment", {
    p_tenant_id: tenantId, p_subscription_id: null, p_provider: "whop",
    p_provider_payment_id: paymentId, p_provider_total_cents: providerCents,
    p_period_start: now.toISOString(), p_period_end: now.toISOString(),
    p_paid_at: now.toISOString(), p_lines: lines,
  });

try {
  console.log("Generation\n");

  const { data: first } = await call(`pay_${stamp}_a`, 24900, planLine(24900));
  const a = first[0];
  check("an invoice is created with a formatted number", /^INV-\d{4}-\d{2}-\d{4}$/.test(a.number), a.number);
  check("totals agreeing reconcile as matched", a.reconciliation === "matched", a.reconciliation);

  const { data: again } = await call(`pay_${stamp}_a`, 24900, planLine(24900));
  check(
    "a redelivered payment returns the same invoice",
    again[0].created === false && again[0].invoice_id === a.invoice_id,
    "Whop delivers at least once — a second bill here would be a real double-charge",
  );

  const { data: second } = await call(`pay_${stamp}_b`, 19800, planLine(9900));
  const b = second[0];
  check("a provider total we did not expect reconciles as mismatched", b.reconciliation === "mismatched");
  check(
    "numbers run consecutively",
    Number(b.number.slice(-4)) === Number(a.number.slice(-4)) + 1,
    `${a.number} then ${b.number}`,
  );

  const { data: lines } = await supabase.from("invoice_lines").select("amount_cents").eq("invoice_id", a.invoice_id);
  const { data: inv } = await supabase.from("invoices").select("total_cents, status").eq("id", a.invoice_id).single();
  check(
    "lines sum exactly to the total",
    lines.reduce((s, l) => s + l.amount_cents, 0) === inv.total_cents,
    `${lines.reduce((s, l) => s + l.amount_cents, 0)} vs ${inv.total_cents}`,
  );
  check("an invoice from a collected payment is born paid", inv.status === "paid", inv.status);

  console.log("\nImmutability (as the app's own service-role client)\n");

  const { error: editTotal } = await supabase.from("invoices").update({ total_cents: 1 }).eq("id", a.invoice_id);
  check("the app CANNOT rewrite an issued invoice's total", editTotal !== null,
        "corrections must be credit notes, never edits");

  const { error: voidIt } = await supabase.from("invoices")
    .update({ status: "void", voided_at: new Date().toISOString(), void_reason: "verification" })
    .eq("id", b.invoice_id);
  check("voiding IS allowed", voidIt === null, voidIt?.message ?? "");

  const { error: editLine } = await supabase.from("invoice_lines").update({ amount_cents: 1 }).eq("invoice_id", a.invoice_id);
  check("the app CANNOT edit a line", editLine !== null);

  const { error: dropLine } = await supabase.from("invoice_lines").delete().eq("invoice_id", a.invoice_id);
  check("the app CANNOT delete a line", dropLine !== null);
} finally {
  console.log("\nCleaning up…");
  await supabase.from("invoices").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);

  // Put the counter back, so verifying never leaves a hole in the real sequence.
  if (counterBefore === null) {
    await supabase.from("invoice_counters").delete().eq("year", YEAR).eq("month", MONTH);
  } else {
    await supabase.from("invoice_counters").update({ next_number: counterBefore }).eq("year", YEAR).eq("month", MONTH);
  }
  const { data: after } = await supabase
    .from("invoice_counters").select("next_number").eq("year", YEAR).eq("month", MONTH).maybeSingle();
  check("the invoice counter is restored", (after?.next_number ?? null) === counterBefore,
        `was ${counterBefore}, now ${after?.next_number ?? null}`);
}

console.log(failures === 0 ? "\nAll invoice checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
