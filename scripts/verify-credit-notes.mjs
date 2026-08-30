// SA-3.8 acceptance: the approval control, and that an invoice is never edited.
//
// Deliberately does NOT execute a real refund against the sandbox payment — a refund is
// irreversible and that is real (if fake-money) payment history. The provider call itself is
// therefore unverified; everything guarding it is verified here.
//
// Needs the app running. Run with: npm run verify:credits
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
const counters = {};
for (const series of ["INV", "CN"]) {
  const { data } = await supabase
    .from("invoice_counters").select("next_number").eq("series", series).eq("year", YEAR).eq("month", MONTH).maybeSingle();
  counters[series] = data?.next_number ?? null;
}

const { data: realAdmin } = await supabase
  .from("admin_users").select("id, role").eq("role", "super_admin").eq("is_active", true).limit(1).single();

// A second super_admin, so "a different admin can approve" can actually be exercised.
const { data: secondAdmin } = await supabase
  .from("admin_users")
  .insert({
    email: `verify-${stamp}@insurvas.invalid`,
    name: "Verification Admin",
    role: "super_admin",
    password_hash: "x",
    totp_secret: "x",
    is_active: true,
  })
  .select("id")
  .single();

const sign = async (adminId, role) =>
  `insurvas_admin_session=${await new SignJWT({ role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;

const cookieA = await sign(realAdmin.id, "super_admin");
const cookieB = await sign(secondAdmin.id, "super_admin");

const { data: tenant } = await supabase
  .from("tenants").insert({ name: `Credit note ${stamp}`, status: "active" }).select("id").single();
const tenantId = tenant.id;

// A custom invoice settled by bank transfer: no provider payment behind it.
const { data: invRows } = await supabase.rpc("create_custom_invoice", {
  p_tenant_id: tenantId, p_subscription_id: null,
  p_reason: "Verification invoice for credit notes",
  p_due_at: new Date().toISOString(), p_created_by: realAdmin.id,
  p_lines: [{ kind: "plan", label: "Consulting", amount_cents: 80000 }],
});
const invoice = invRows[0];

async function cleanup() {
  await supabase.from("credit_notes").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_credits").delete().eq("tenant_id", tenantId);
  await supabase.from("invoices").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
  await supabase.from("admin_users").delete().eq("id", secondAdmin.id);
  for (const [series, value] of Object.entries(counters)) {
    if (value === null) {
      await supabase.from("invoice_counters").delete().eq("series", series).eq("year", YEAR).eq("month", MONTH);
    } else {
      await supabase.from("invoice_counters").update({ next_number: value })
        .eq("series", series).eq("year", YEAR).eq("month", MONTH);
    }
  }
}

const post = (path, cookie, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

try {
  console.log("Refund validation\n");

  const noCharge = await post("/api/admin/credit-notes", cookieA, {
    tenant_id: tenantId, invoice_id: invoice.invoice_id, type: "refund",
    amount: "100.00", reason_code: "goodwill",
  });
  const noChargeBody = await noCharge.json();
  check(
    "a refund against an invoice with no card charge is refused",
    noCharge.status === 409 && /bank transfer/i.test(noChargeBody.error ?? ""),
    JSON.stringify(noChargeBody).slice(0, 140),
  );

  const waiver = await post("/api/admin/credit-notes", cookieA, {
    tenant_id: tenantId, type: "waiver", amount: "10.00", reason_code: "goodwill",
  });
  check("a waiver is refused with a reason, not silently accepted", waiver.status === 409, String(waiver.status));

  console.log("\nThe approval control\n");

  // Raised directly so no real refund is ever executed against the sandbox.
  const { data: bigRows } = await supabase.rpc("request_credit_note", {
    p_tenant_id: tenantId, p_invoice_id: invoice.invoice_id, p_type: "refund",
    p_amount_cents: 60000, p_reason_code: "billing_error", p_reason_text: "verification",
    p_requested_by: realAdmin.id, p_threshold_cents: 50000,
  });
  const big = bigRows[0];

  check("a $600 refund is held for approval", big.status === "pending_approval", big.status);
  check("it gets a CN number from its own series", /^CN-\d{4}-\d{2}-\d{4}$/.test(big.number), big.number);

  const { data: moved } = await supabase
    .from("credit_notes").select("provider_refund_id, status").eq("id", big.credit_note_id).single();
  check("no money has moved while it is pending",
        moved.provider_refund_id === null && moved.status === "pending_approval");

  const selfApprove = await post(`/api/admin/credit-notes/${big.credit_note_id}/approve`, cookieA, {});
  const selfBody = await selfApprove.json();
  check(
    "the requester CANNOT approve their own, even as super_admin",
    selfApprove.status === 409 && /cannot approve/i.test(selfBody.error ?? ""),
    JSON.stringify(selfBody).slice(0, 140),
  );

  // The database refuses it too, independently of the route.
  const { error: dbSelfApprove } = await supabase
    .from("credit_notes")
    .update({ status: "approved", approved_by: realAdmin.id })
    .eq("id", big.credit_note_id);
  check("the DATABASE also refuses a self-approval", dbSelfApprove !== null,
        "the check constraint is the guard that cannot be routed around");

  // Through the ROUTE with the second admin's session, not by writing the row directly — the
  // control is only proven if the real path enforces it.
  const otherApprove = await post(`/api/admin/credit-notes/${big.credit_note_id}/approve`, cookieB, {});
  const otherBody = await otherApprove.json();

  const { data: afterApproval } = await supabase
    .from("credit_notes").select("status, approved_by, failure_reason").eq("id", big.credit_note_id).single();

  check(
    "a DIFFERENT admin's approval is accepted",
    afterApproval.approved_by === secondAdmin.id,
    JSON.stringify(otherBody).slice(0, 140),
  );

  // This invoice has no card charge, so execution must fail — which is the criterion about a
  // failed provider refund being LEFT in failed rather than rolled back or retried silently.
  check(
    "a refund that cannot be executed is left in `failed` with a reason",
    afterApproval.status === "failed" && Boolean(afterApproval.failure_reason),
    JSON.stringify(afterApproval),
  );

  console.log("\nThe invoice is never edited\n");

  const { data: untouched } = await supabase
    .from("invoices").select("total_cents, status, number").eq("id", invoice.invoice_id).single();
  check(
    "the original invoice is unchanged by the credit note",
    untouched.total_cents === 80000 && untouched.number === invoice.number,
    JSON.stringify(untouched),
  );

  console.log("\nCredits\n");

  const credit = await post("/api/admin/credit-notes", cookieA, {
    tenant_id: tenantId, type: "credit", amount: "124.50", reason_code: "service_issue",
    reason_text: "Outage on the 14th",
  });
  const creditBody = await credit.json();
  check("a credit of any amount needs no second approver", credit.status === 201 && creditBody.awaitingApproval === false,
        JSON.stringify(creditBody).slice(0, 140));

  const { data: balance } = await supabase
    .from("tenant_credits").select("balance_cents").eq("tenant_id", tenantId).single();
  check("the credit reaches the tenant's balance", balance.balance_cents === 12450, String(balance.balance_cents));

  const { data: notes } = await supabase
    .from("credit_notes").select("number").eq("tenant_id", tenantId).order("number");
  check("credit note numbers are consecutive in their own series",
        notes.length === 2 && Number(notes[1].number.slice(-4)) === Number(notes[0].number.slice(-4)) + 1,
        notes.map((n) => n.number).join(", "));

  const { data: auditRows } = await supabase
    .from("audit_log").select("action").eq("target_type", "credit_note").gte("ts", new Date(stamp).toISOString());
  check("credit notes are audit-logged", (auditRows ?? []).some((a) => a.action === "credit_note.requested"));
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll credit note checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
