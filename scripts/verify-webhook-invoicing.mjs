// bugs_sa.md M3-2 · A real payment that cannot be invoiced must NOT be acknowledged.
//
// createInvoiceFromPayment returned a bare null on six different conditions and the webhook
// treated every one as normal: marked the event processed, returned 200. That is right for Whop's
// dashboard test event, which carries placeholder ids and no metadata, and wrong for a real one —
// money could be collected and never appear in the local ledger, with nothing recorded to say so.
// The two were indistinguishable.
//
// Run: npm run verify:webhook-invoicing
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (l, c, d = "") => { console.log(c ? `  ok   ${l}` : `  FAIL ${l}${d ? " — " + d : ""}`); if (!c) failures++; };

const stamp = Date.now();
const tenants = [];
const eventIds = [];

async function send(id, envelope) {
  const raw = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.WHOP_WEBHOOK_SECRET).update(`${id}.${ts}.${raw}`).digest("base64");
  eventIds.push(id);
  return fetch(`${BASE}/api/webhooks/whop`, {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` },
    body: raw,
  });
}

try {
  console.log("An unattributable payment is Whop's test event — acknowledge it\n");

  const testId = `msg_wi_${stamp}_test`;
  const testRes = await send(testId, {
    id: testId, type: "payment.succeeded", api_version: "v1", timestamp: new Date().toISOString(),
    data: { id: `pay_placeholder_${stamp}`, total: "9.99" },
  });
  check("a payment with no tenant is accepted", testRes.status === 200, `HTTP ${testRes.status}`);

  const { data: testEvent } = await supabase
    .from("webhook_events").select("processed_at").eq("event_id", testId).maybeSingle();
  check("  and marked processed, so Whop stops retrying", testEvent?.processed_at !== null,
        "an unattributable event would otherwise retry forever");

  console.log("\nA REAL tenant's payment that cannot be invoiced must not be acknowledged\n");

  const { data: t } = await supabase.from("tenants").insert({ name: `M3-2 ${stamp}`, status: "active" }).select("id").single();
  tenants.push(t.id);

  // Attributable to a real tenant, but the plan metadata names a plan that is not ours — so no
  // invoice can be produced for money that WAS collected.
  const realId = `msg_wi_${stamp}_real`;
  const realRes = await send(realId, {
    id: realId, type: "payment.succeeded", api_version: "v1", timestamp: new Date().toISOString(),
    data: {
      id: `pay_real_${stamp}`, total: "99.00",
      metadata: { tenant_id: t.id },
      plan: { id: "plan_unknown", metadata: { insurvas_plan_id: "00000000-0000-0000-0000-000000000000", insurvas_billing_cycle: "monthly" } },
    },
  });
  check("the event is NOT acknowledged with a 200", realRes.status >= 500, `HTTP ${realRes.status}`);

  const { data: realEvent } = await supabase
    .from("webhook_events").select("processed_at, process_error").eq("event_id", realId).maybeSingle();
  check("  it is left unprocessed, so Whop retries", realEvent?.processed_at === null,
        `processed_at=${realEvent?.processed_at}`);
  check("  and the reason is recorded durably, not just logged",
        typeof realEvent?.process_error === "string" && /no invoice|plan_not_found|plan_not_ours/i.test(realEvent.process_error),
        String(realEvent?.process_error).slice(0, 120));

  const { data: invoices } = await supabase.from("invoices").select("id").eq("tenant_id", t.id);
  check("  and no invoice was invented for it", (invoices ?? []).length === 0, `${invoices?.length} invoice(s)`);
} finally {
  for (const id of tenants) {
    await supabase.from("invoices").delete().eq("tenant_id", id);
    await supabase.from("tenants").delete().eq("id", id);
  }
  for (const id of eventIds) await supabase.from("webhook_events").delete().eq("event_id", id);
}

console.log(failures === 0 ? "\nAll webhook invoicing checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
