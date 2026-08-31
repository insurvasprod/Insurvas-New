// SA-3.4 acceptance: provider events driving subscription state, checked end to end through the
// running app rather than by calling the handler directly.
//
// Needs the app running (defaults to the dev server). Everything happens under a throwaway tenant
// and is removed afterwards. Run with: npm run verify:events
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TARGET = process.env.WEBHOOK_TARGET_URL ?? "http://localhost:3000/api/webhooks/whop";
const secret = process.env.WHOP_WEBHOOK_SECRET;
if (!secret) {
  console.error("WHOP_WEBHOOK_SECRET missing from .env.local");
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

const stamp = Date.now();
const { data: tenant } = await supabase
  .from("tenants").insert({ name: `Event check ${stamp}`, status: "active" }).select("id").single();
const tenantId = tenant.id;

const { data: plan } = await supabase
  .from("plans").select("id").eq("code", "basic").eq("version", 1).single();

async function cleanup() {
  await supabase.from("payments").delete().eq("tenant_id", tenantId);
  await supabase.from("invoices").delete().eq("tenant_id", tenantId);
  await supabase.from("webhook_events").delete().like("event_id", `msg_ev_${stamp}%`);
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

/** Seconds of offset from a fixed base, so event ordering is explicit rather than incidental. */
const BASE = Date.now() - 3_600_000;
const at = (offsetSeconds) => new Date(BASE + offsetSeconds * 1000).toISOString();

async function send(type, { offset, chargeId = null, extra = {}, suffix = "" }) {
  const id = `msg_ev_${stamp}_${type}${suffix}`;
  const envelope = {
    id,
    type,
    api_version: "v1",
    timestamp: at(offset),
    data: {
      id: chargeId ?? `pay_ev_${stamp}${suffix}`,
      metadata: { tenant_id: tenantId },
      // The plan node a genuine Whop payment for one of our plans carries. It used to be omitted,
      // which meant every payment.succeeded here produced no invoice — silently accepted before
      // bugs_sa.md M3-2 was fixed, and now correctly refused. Sending the realistic shape keeps
      // this script testing subscription state rather than depending on that hole.
      plan: { id: "plan_ev", metadata: { insurvas_plan_id: plan.id, insurvas_billing_cycle: "monthly" } },
      total: 99,
      paid_at: at(offset),
      ...extra,
    },
  };
  const body = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${id}.${ts}.${body}`).digest("base64");
  const res = await fetch(TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    },
    body,
  });
  if (res.status !== 200) throw new Error(`${type} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function state() {
  const { data: sub } = await supabase
    .from("subscriptions").select("status, last_provider_event_at").eq("tenant_id", tenantId).single();
  const { data: ent } = await supabase
    .from("tenant_entitlements").select("entitlement").eq("tenant_id", tenantId).maybeSingle();
  return { status: sub.status, access: ent?.entitlement?.access ?? null };
}

try {
  await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenantId,
    p_plan_id: plan.id,
    p_billing_cycle: "monthly",
    p_start: new Date().toISOString(),
  });

  console.log("Payment succeeds\n");
  await send("payment.succeeded", { offset: 100 });
  let s = await state();
  check("subscription becomes active", s.status === "active", s.status);
  check("entitlement access is full", s.access === "full", String(s.access));

  const { data: paid } = await supabase.from("payments").select("id, amount_cents, method").eq("tenant_id", tenantId);
  check("the payment is recorded", paid.length === 1 && paid[0].amount_cents === 9900,
        JSON.stringify(paid));
  check("recorded as a provider payment", paid[0]?.method === "provider");

  console.log("\nPayment fails — Whop is still retrying\n");
  await send("payment.failed", { offset: 200 });
  s = await state();
  check("subscription becomes past_due", s.status === "past_due", s.status);
  check(
    "access stays FULL during Whop's retry window",
    s.access === "full",
    "a card that clears tomorrow must not cost the customer their write access today",
  );

  console.log("\nAn event that arrives late but happened earlier\n");
  // Whop does not guarantee ordering. This one happened BEFORE the failure above.
  await send("payment.succeeded", { offset: 150, suffix: "_stale", chargeId: `pay_ev_${stamp}_stale` });
  s = await state();
  check(
    "a stale event does not resurrect the earlier state",
    s.status === "past_due",
    `status became ${s.status} — last-received-wins would have reactivated a failing tenant`,
  );

  console.log("\nWhop gives up\n");
  await send("membership.deactivated", { offset: 300 });
  s = await state();
  check("subscription becomes suspended", s.status === "suspended", s.status);
  check(
    "access drops to read_only, not none",
    s.access === "read_only",
    "a suspended tenant must still see the book of business they built",
  );

  console.log("\nIdempotency\n");
  const before = (await supabase.from("payments").select("id").eq("tenant_id", tenantId)).data.length;
  await send("payment.succeeded", { offset: 400, chargeId: `pay_ev_${stamp}`, suffix: "_again" });
  const after = (await supabase.from("payments").select("id").eq("tenant_id", tenantId)).data.length;
  // Written as one comparison: `after === before + 0 || after === before` is the same test twice,
  // which reads like two conditions and proves one.
  check("the same charge id is not recorded twice", after === before,
        `payments went from ${before} to ${after} — a redelivered charge created a second record`);

  s = await state();
  check("paying again restores active", s.status === "active", s.status);
  check("and access returns to full", s.access === "full", String(s.access));
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll subscription event checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
