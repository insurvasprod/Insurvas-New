/**
 * The period billing run (backlog #41, #44, #46).
 *
 * For every subscription whose period has ended: gather attached add-ons, metered overage above the
 * allowance, and any charge parked by a mid-period plan change; apply whatever credit the tenant
 * holds; raise one invoice for the lot. Then roll the periods.
 *
 * ORDER IS THE WHOLE THING. Usage is keyed by period_start, so once advance_billing_periods() runs,
 * "this period's usage" means the new empty bucket. Billing after the roll would charge every
 * customer for zero overage, every time, and look perfectly healthy doing it. Hence: bill, then
 * roll, in that order, in one script, so the two cannot be scheduled apart.
 *
 * Safe to run twice. period_billing_runs has a primary key of (subscription_id, period_start) and
 * the invoice is created in the same transaction as the ledger row, so a second run finds the
 * period already billed and does nothing.
 *
 *   npm run bill:periods           bill, then roll
 *   npm run bill:periods -- --dry  report what would be billed, change nothing
 *   npm run bill:periods -- --no-advance   bill only, leave the periods alone
 *
 * This is what SA-6.1 should schedule. Until then it is manual — and per the doc, a job that
 * silently never runs looks identical to a healthy one, so it prints loudly either way.
 */
import { createClient } from "@supabase/supabase-js";

import { assemblePeriodInvoice } from "../lib/billing/lines.ts";
import { findDueSubscriptions, billSubscriptionPeriod } from "../lib/billing/gather.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry");
const skipAdvance = process.argv.includes("--no-advance") || dryRun;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const due = await findDueSubscriptions(supabase);

// `process.exitCode` throughout rather than `process.exit()`: on Node 24 for Windows, exiting
// while the Supabase client's sockets are still closing trips a libuv assertion and returns 9,
// which CI would read as a failed run of a job that did exactly what it should.
if (due.length === 0) {
  console.log("Nothing due — every live subscription's period is still running.");
  process.exitCode = 0;
} else {
  await billEverything(due);
}

async function billEverything(due) {
console.log(`${due.length} subscription(s) with a period that has ended.${dryRun ? "  [dry run]" : ""}\n`);

let invoiced = 0;
let totalCents = 0;
let creditSpent = 0;
let skipped = 0;
let failed = 0;

for (const subscription of due) {
  const label = `${subscription.tenant_name}  ${subscription.current_period_start.slice(0, 10)} → ${subscription.current_period_end.slice(0, 10)}`;

  if (dryRun) {
    // The same assembly the real run uses, just never handed to the database. Anything this
    // reports is exactly what a real run would bill.
    const preview = await previewOnly(subscription);
    if (preview.error) {
      console.log(`  ✗ ${label}\n      ${preview.error}`);
      failed++;
    } else if (preview.lines.length === 0) {
      console.log(`  · ${label}\n      nothing beyond the plan`);
      skipped++;
    } else {
      console.log(`  → ${label}\n      would bill ${money(preview.totalCents)} across ${preview.lines.length} line(s)`);
      for (const line of preview.lines) {
        console.log(`        ${line.kind.padEnd(8)} ${line.label} — ${money(line.amount_cents)}`);
      }
      invoiced++;
      totalCents += preview.totalCents;
      creditSpent += preview.creditAppliedCents;
    }
    continue;
  }

  const outcome = await billSubscriptionPeriod(supabase, subscription);

  if (outcome.error) {
    console.log(`  ✗ ${label}\n      ${outcome.error}`);
    failed++;
  } else if (outcome.alreadyBilled) {
    console.log(`  = ${label}\n      already billed${outcome.invoiceNumber ? ` as ${outcome.invoiceNumber}` : ""}`);
    skipped++;
  } else if (!outcome.invoiceId) {
    console.log(`  · ${label}\n      nothing beyond the plan to bill`);
    skipped++;
  } else {
    console.log(`  → ${label}\n      ${outcome.invoiceNumber}  ${money(outcome.totalCents)}  ${outcome.lineCount} line(s)`);
    invoiced++;
    totalCents += outcome.totalCents;
    creditSpent += outcome.creditAppliedCents;
  }

  if (outcome.creditAppliedCents > 0) {
    console.log(`      ${money(outcome.creditAppliedCents)} of account credit applied`);
  }
  // Reported rather than silently dropped: an add-on billed on a different cycle is a real
  // configuration people will hit, and it must not look like the add-on is free.
  for (const name of outcome.skippedAddons) {
    console.log(`      ! "${name}" bills on a different cycle and was not included`);
  }
}

console.log("");
console.log(`${invoiced} invoice(s) raised, ${money(totalCents)} total, ${money(creditSpent)} of credit applied.`);
if (skipped) console.log(`${skipped} had nothing to bill or were already billed.`);
if (failed) console.log(`${failed} failed — see above.`);

if (!skipAdvance) {
  console.log("\nAdvancing billing periods…");
  const { data: rolled, error } = await supabase.rpc("advance_billing_periods");
  if (error) {
    console.error(`Periods could not be advanced: ${error.message}`);
    process.exitCode = 1;
  }
  for (const row of rolled ?? []) {
    console.log(`  ${row.action.padEnd(14)} ${row.subscription_id}`);
  }
  console.log(`${(rolled ?? []).length} subscription(s) advanced.`);
} else if (!dryRun) {
  console.log("\nPeriods were NOT advanced (--no-advance).");
}

process.exitCode = failed > 0 ? 1 : 0;
}

/** Everything billSubscriptionPeriod does except the write. */
async function previewOnly(subscription) {
  try {
    const [pending, addons, usage, pricing, credit] = await Promise.all([
      supabase.from("pending_charges").select("id, kind, label, quantity, included_qty, unit_cents, amount_cents")
        .eq("subscription_id", subscription.id).is("billed_at", null),
      supabase.from("subscription_addons").select("addon_id").eq("subscription_id", subscription.id).is("detached_at", null),
      supabase.rpc("admin_usage_monitor", { p_over_80: false }),
      supabase.from("meter_pricing").select("meter_key, sell_cents"),
      supabase.from("tenant_credits").select("balance_cents").eq("tenant_id", subscription.tenant_id).maybeSingle(),
    ]);

    const addonIds = (addons.data ?? []).map((a) => a.addon_id);
    const { data: addonRows } = addonIds.length
      ? await supabase.from("addons").select("code, name, price_cents, billing_cycle").in("id", addonIds)
      : { data: [] };

    return assemblePeriodInvoice({
      pending: (pending.data ?? []).map((r) => ({
        id: r.id, kind: r.kind, label: r.label,
        quantity: Number(r.quantity ?? 1),
        includedQty: r.included_qty === null ? null : Number(r.included_qty),
        unitCents: Number(r.unit_cents ?? 0), amountCents: Number(r.amount_cents),
      })),
      addons: (addonRows ?? []).map((a) => ({
        code: a.code, name: a.name, priceCents: a.price_cents, billingCycle: a.billing_cycle,
      })),
      cycle: subscription.billing_cycle,
      usage: (usage.data ?? [])
        .filter((r) => r.tenant_id === subscription.tenant_id && r.period_start === subscription.current_period_start)
        .map((r) => ({
          meterKey: r.meter_key, label: r.meter_label, unit: r.unit,
          usedQty: r.used_qty ?? 0, includedQty: r.included_qty, hardCap: r.hard_cap ?? true,
        })),
      pricing: (pricing.data ?? []).map((p) => ({ meterKey: p.meter_key, sellCents: p.sell_cents })),
      creditBalanceCents: credit.data?.balance_cents ?? 0,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), lines: [], totalCents: 0, creditAppliedCents: 0 };
  }
}
