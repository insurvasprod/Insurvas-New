/**
 * Raise the missing invoices for payments that were collected before invoice generation existed
 * (backlog #37).
 *
 * Two real sandbox payments — plan_a at $198 and plan_b at $249 — were taken before SA-3.2 built
 * the generator, so neither produced an invoice. Their envelopes are still in `webhook_events`, and
 * `create_invoice_for_payment` is idempotent on (provider, provider_payment_id), so replaying them
 * is safe and repeatable.
 *
 * The plan_a one will come out MISMATCHED: our records say $99 and the provider charged $198. That
 * is the correct outcome and the reason to do this at all — the double-charge deserves a record
 * that says so, rather than no record. Inventing a $198 line to make it match would erase the
 * evidence of the incident.
 *
 * The lines are rebuilt with the same buildInvoiceLines() the live receiver uses, so a backfilled
 * invoice is indistinguishable from one raised at the time.
 *
 *   npm run backfill:invoices           report what is missing, change nothing
 *   npm run backfill:invoices -- --write   raise them
 */
import { createClient } from "@supabase/supabase-js";

import { buildInvoiceLines } from "../lib/invoices/lines.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const write = process.argv.includes("--write");
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const PRICE_COLUMN = {
  monthly: "price_monthly_cents",
  quarterly: "price_quarterly_cents",
  yearly: "price_yearly_cents",
};

const money = (cents) => (cents === null || cents === undefined ? "—" : `$${(cents / 100).toFixed(2)}`);
const str = (source, key) => {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

// Same event types the live receiver treats as a collected payment.
const { data: events, error } = await supabase
  .from("webhook_events")
  .select("id, event_id, event_type, payload, tenant_id, occurred_at")
  .eq("provider", "whop")
  .in("event_type", ["payment.succeeded", "payment_succeeded", "payment.completed"])
  .order("occurred_at", { ascending: true });

if (error) {
  console.error(`Could not read webhook_events: ${error.message}`);
  process.exit(1);
}

if (!events?.length) {
  console.log("No stored payment events to replay.");
  process.exit(0);
}

console.log(`${events.length} stored payment event(s).${write ? "" : "  [read-only — pass --write to raise them]"}\n`);

let raised = 0;
let existed = 0;
let skipped = 0;
let mismatched = 0;

for (const event of events) {
  const data = event.payload?.data ?? {};
  const paymentId = str(data, "id");

  if (!paymentId) {
    console.log(`  · ${event.event_id}: no payment id in the envelope`);
    skipped++;
    continue;
  }

  const { data: already } = await supabase
    .from("invoices")
    .select("id, number, reconciliation")
    .eq("provider", "whop")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();

  if (already) {
    console.log(`  = ${paymentId}: already invoiced as ${already.number} (${already.reconciliation})`);
    existed++;
    continue;
  }

  const planMetadata = data.plan?.metadata ?? {};
  const ourPlanId = str(planMetadata, "insurvas_plan_id");
  const billingCycle = str(planMetadata, "insurvas_billing_cycle");
  const tenantId = event.tenant_id;

  // Every reason to skip is printed. A backfill that quietly did nothing for half its input would
  // leave someone believing the gap was closed.
  if (!tenantId) { console.log(`  ✗ ${paymentId}: the event was never matched to a tenant`); skipped++; continue; }
  if (!ourPlanId || !billingCycle || !PRICE_COLUMN[billingCycle]) {
    console.log(`  ✗ ${paymentId}: the plan metadata Whop returned does not name one of our plans`);
    skipped++;
    continue;
  }

  const { data: plan } = await supabase.from("plans").select("id, name, version").eq("id", ourPlanId).maybeSingle();
  if (!plan) { console.log(`  ✗ ${paymentId}: plan ${ourPlanId} no longer exists`); skipped++; continue; }

  const { data: prices } = await supabase
    .from("plan_prices")
    .select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents")
    .eq("plan_id", ourPlanId)
    .maybeSingle();

  const priceCents = prices?.[PRICE_COLUMN[billingCycle]] ?? null;
  if (priceCents === null) { console.log(`  ✗ ${paymentId}: plan is not priced ${billingCycle}`); skipped++; continue; }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, current_period_start, current_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const lines = buildInvoiceLines(
    {
      name: plan.name,
      version: plan.version,
      billingCycle,
      priceCents,
      setupFeeCents: prices?.setup_fee_cents ?? 0,
    },
    { isFirstPeriod: str(data, "billing_reason") === "subscription_create" },
  );

  const ourTotal = lines.reduce(
    (sum, l) => (l.kind === "discount" || l.kind === "credit" ? sum - Math.abs(l.amount_cents) : sum + l.amount_cents),
    0,
  );

  const rawTotal = data.total;
  const providerTotalCents =
    typeof rawTotal === "number" ? Math.round(rawTotal * 100)
      : typeof rawTotal === "string" ? Math.round(Number(rawTotal) * 100)
      : null;

  const willMismatch = providerTotalCents !== null && providerTotalCents !== ourTotal;
  const verdict = providerTotalCents === null ? "not_applicable" : willMismatch ? "mismatched" : "matched";
  if (willMismatch) mismatched++;

  const summary = `${paymentId}  ours ${money(ourTotal)} vs provider ${money(providerTotalCents)}  → ${verdict}`;

  if (!write) {
    console.log(`  → would raise: ${summary}`);
    raised++;
    continue;
  }

  const { data: result, error: createError } = await supabase.rpc("create_invoice_for_payment", {
    p_tenant_id: tenantId,
    p_subscription_id: subscription?.id ?? null,
    p_provider: "whop",
    p_provider_payment_id: paymentId,
    p_provider_total_cents: providerTotalCents,
    p_period_start: subscription?.current_period_start ?? null,
    p_period_end: subscription?.current_period_end ?? null,
    p_paid_at: event.occurred_at ?? new Date().toISOString(),
    p_lines: lines,
  });

  if (createError) {
    console.log(`  ✗ ${paymentId}: ${createError.message}`);
    skipped++;
    continue;
  }

  const row = Array.isArray(result) ? result[0] : result;
  console.log(`  ${row.created ? "→ raised  " : "= existed "} ${row.number}  ${summary}`);
  if (row.created) raised++;
  else existed++;
}

console.log("");
console.log(write
  ? `${raised} invoice(s) raised, ${existed} already existed, ${skipped} skipped.`
  : `${raised} invoice(s) would be raised, ${existed} already exist, ${skipped} would be skipped.`);

if (mismatched > 0) {
  console.log(`${mismatched} will be marked MISMATCHED — that is the intended record of a payment whose amount disagrees with our plan price, not a bug to fix.`);
}
