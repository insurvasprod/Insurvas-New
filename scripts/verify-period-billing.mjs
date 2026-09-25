/**
 * End-to-end verification of the period billing run (backlog #41, #44, #46).
 *
 * The unit tests in lib/billing/lines.test.mjs prove the arithmetic. This proves the parts are
 * actually joined — that an add-on, some overage, a queued proration and a credit balance all reach
 * one real invoice in a real database, and that running the job twice does not bill anyone twice.
 *
 * Creates its own tenant, plan, add-on and usage, and deletes all of it afterwards.
 *
 *   npm run verify:period-billing
 */
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";
// The real assembler, not a re-implementation of it. Everything below the waiver section goes
// through the same billSubscriptionPeriod the scheduled job calls, which is also what proves that
// module still loads under plain Node -- a `@/` value import anywhere in its graph would break
// `npm run bill:periods` and nothing else would notice.
import { billSubscriptionPeriod } from "../lib/billing/gather.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = Date.now();

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
  return ok;
}
function ensure(label, condition, detail) {
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition ? "" : `\n      ${detail ?? ""}`}`);
  if (!condition) failures++;
  return condition;
}

let tenantId = null;
let ownerId = null;
let subscriptionId = null;
let planId = null;
let addonId = null;
const invoiceIds = [];

async function cleanup() {
  console.log("\nCleaning up…");
  if (subscriptionId) {
    await sb.from("billing_waivers").delete().eq("subscription_id", subscriptionId);
    await sb.from("period_billing_runs").delete().eq("subscription_id", subscriptionId);
    await sb.from("pending_charges").delete().eq("subscription_id", subscriptionId);
    await sb.from("subscription_addons").delete().eq("subscription_id", subscriptionId);
  }
  for (const id of invoiceIds) {
    // Draft first: prevent_issued_invoice_mutation refuses to delete an issued invoice, and a
    // cleanup that silently fails is what left orphan rows above the invoice counter before.
    await sb.from("platform_invoices").update({ status: "draft" }).eq("id", id);
    await sb.from("platform_invoice_lines").delete().eq("invoice_id", id);
    const { error } = await sb.from("platform_invoices").delete().eq("id", id);
    if (error) console.error(`  cleanup: invoice ${id} was not removed -- ${error.message}`);
  }
  if (tenantId) {
    await sb.from("tenant_users").delete().eq("tenant_id", tenantId);
    await sb.from("usage_totals").delete().eq("tenant_id", tenantId);
    await sb.from("tenant_credits").delete().eq("tenant_id", tenantId);
    // Platform invoices are immutable after issue. Retain this namespaced history and deactivate
    // the fixture instead of attempting to delete billing evidence.
    await sb.from("tenants").update({
      status: "suspended",
      suspended_at: new Date().toISOString(),
      suspension_reason: "Disposable period-billing fixture retained for immutable QA evidence",
    }).eq("id", tenantId);
    if (subscriptionId) {
      await sb.from("subscriptions").update({ status: "cancelled" }).eq("id", subscriptionId);
    }
  }
  // Removes the auth.users row as well; deleting only public.users would leave an orphan whose
  // email collides with the next run.
  await deleteFixtureUser(sb, ownerId);
  if (addonId) await sb.from("addons").delete().eq("id", addonId);
  if (planId) {
    await sb.from("plan_meters").delete().eq("plan_id", planId);
    await sb.from("plan_prices").delete().eq("plan_id", planId);
    const { error: planError } = await sb.from("plans").delete().eq("id", planId);
    if (planError) {
      // The tenant above is retained rather than deleted, because its platform invoices are
      // immutable -- so its cancelled subscription still references this plan and the delete is
      // refused. Archive it instead.
      //
      // This matters beyond tidiness. A fixture plan carries sort_order 0, so while it stays
      // unarchived it sorts ahead of Basic, and every suite that picks "the first unarchived plan"
      // gets a plan with no features and no prices. That is what made verify-kill-switches report
      // "grants no features" and verify-system-maintenance die on `cycle_not_offered`. Both now
      // name their plan, and this stops leaving the trap in the first place.
      const { error: archiveError } = await sb.from("plans").update({ is_archived: true }).eq("id", planId);
      if (archiveError) console.error(`  cleanup: plan ${planId} neither removed nor archived -- ${archiveError.message}`);
    }
  }
}

/**
 * Thrown for a condition that is not a failed check but a reason the run cannot happen at all — an
 * unapplied migration, an unpriced meter. Kept distinct from an assertion failure so the output can
 * say "this could not be verified" rather than "this is broken".
 */
class NotReady extends Error {}

try {
  // ── the table must exist before anything else is worth trying ──────────────
  const { error: tableError } = await sb.from("period_billing_runs").select("subscription_id").limit(1);
  if (tableError) {
    throw new NotReady(
      `supabase/migrations/0017_period_billing.sql has not been applied to this project.\n  ${tableError.message}`,
    );
  }

  console.log("Setting up a tenant with a plan, an add-on, overage and a credit balance…");

  // A plan with a metered allowance, so overage has something to exceed.
  const { data: plan, error: planError } = await sb
    .from("plans")
    .insert({ name: `Period billing verify ${stamp}`, code: `pbv_${stamp}`, version: 1, plan_type: "individual", is_archived: false })
    .select("id")
    .single();
  if (planError) throw new Error(`plan: ${planError.message}`);
  planId = plan.id;

  await sb.from("plan_prices").insert({ plan_id: planId, price_monthly_cents: 9900, setup_fee_cents: 0 });

  // Pick a meter that is priced, otherwise overage is deliberately not billed.
  const { data: priced } = await sb.from("meter_pricing").select("meter_key, sell_cents").gt("sell_cents", 0).limit(1);
  const meterKey = priced?.[0]?.meter_key ?? null;
  const sellCents = priced?.[0]?.sell_cents ?? 0;
  if (!meterKey) {
    throw new NotReady("No meter has a sell price, so overage cannot be verified. Price one in Configuration Center.");
  }
  await sb.from("plan_meters").insert({ plan_id: planId, meter_key: meterKey, included_qty: 100, hard_cap: false });

  // create_tenant_with_owner is the legacy provisioning RPC: it inserts a public.users row with no
  // id, which users_id_fkey has made impossible since SA-1.2 moved credentials to Supabase Auth.
  // verify-kill-switches already carries this same fallback. The RPC itself is still wired into
  // POST /api/admin/tenants and is broken there too -- see the backlog.
  ({ userId: ownerId } = await createFixtureUser(sb, { email: `period-billing-${stamp}@invalid.test`, name: "Period Billing Verify" }));
  const { data: madeTenant, error: tenantError } = await sb
    .from("tenants")
    .insert({ name: `Period billing verify ${stamp}`, status: "active", onboarding_state: "completed" })
    .select("id").single();
  if (tenantError) throw new Error(`tenant: ${tenantError.message}`);
  tenantId = madeTenant.id;
  const { error: membershipError } = await sb.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner", accepted_at: new Date().toISOString() });
  if (membershipError) throw new Error(`membership: ${membershipError.message}`);

  // A period that ended yesterday, so the run considers it.
  const periodStart = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const periodEnd = new Date(Date.now() - 86_400_000).toISOString();

  const { error: subError } = await sb.rpc("admin_assign_subscription", {
    p_tenant_id: tenantId,
    p_plan_id: planId,
    p_billing_cycle: "monthly",
    p_start: periodStart,
  });
  if (subError) throw new Error(`subscription: ${subError.message}`);

  const { data: sub } = await sb.from("subscriptions").select("id").eq("tenant_id", tenantId).single();
  subscriptionId = sub.id;
  await sb.from("subscriptions").update({ current_period_start: periodStart, current_period_end: periodEnd }).eq("id", subscriptionId);

  // An add-on on the same cycle.
  const { data: addon, error: addonError } = await sb
    .from("addons")
    .insert({ code: `pbv_seats_${stamp}`, name: "Verify seats", price_cents: 1500, billing_cycle: "monthly", is_active: true })
    .select("id")
    .single();
  if (addonError) throw new Error(`addon: ${addonError.message}`);
  addonId = addon.id;
  await sb.from("subscription_addons").insert({ subscription_id: subscriptionId, addon_id: addonId });

  // 150 units against an allowance of 100 → 50 units of overage.
  await sb.from("usage_totals").insert({ tenant_id: tenantId, meter_key: meterKey, period_start: periodStart, used_qty: 150 });

  // A pending proration, as a mid-period upgrade would leave.
  const { data: pending, error: pendingError } = await sb
    .from("pending_charges")
    .insert({
      tenant_id: tenantId, subscription_id: subscriptionId,
      kind: "plan", label: "Verify upgrade, 19 days", quantity: 19,
      unit_cents: 1448, amount_cents: 27519, reason: "Period billing verification",
    })
    .select("id")
    .single();
  if (pendingError) throw new Error(`pending charge: ${pendingError.message}`);

  // A credit balance smaller than the bill, so it is spent in full and something remains payable.
  await sb.rpc("adjust_tenant_credit", { p_tenant_id: tenantId, p_delta_cents: 2000 });

  const expectedOverage = 50 * sellCents;
  const expectedSubtotal = 27519 + 1500 + expectedOverage;
  const expectedTotal = expectedSubtotal - 2000;

  console.log(`\nBilling the period (expecting ${expectedSubtotal} - 2000 credit = ${expectedTotal} cents)…`);

  const { data: billed, error: billError } = await sb.rpc("bill_subscription_period", {
    p_subscription_id: subscriptionId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_lines: [
      { kind: "plan", label: "Verify upgrade, 19 days", quantity: 19, unit_cents: 1448, amount_cents: 27519 },
      { kind: "addon", label: "Verify seats", quantity: 1, unit_cents: 1500, amount_cents: 1500 },
      { kind: "overage", label: `${meterKey} overage`, quantity: 50, included_qty: 100, unit_cents: sellCents, amount_cents: expectedOverage },
      { kind: "credit", label: "Account credit applied", quantity: 1, unit_cents: 2000, amount_cents: 2000 },
    ],
    p_pending_ids: [pending.id],
    p_reason: "Period billing verification run",
    p_credit_cents: 2000,
    p_due_at: null,
    p_created_by: null,
  });
  if (billError) throw new Error(`bill: ${billError.message}`);

  const run = Array.isArray(billed) ? billed[0] : billed;
  if (run.invoice_id) invoiceIds.push(run.invoice_id);

  check("an invoice is raised", Boolean(run.invoice_id), true);
  check("the total is the charges minus the credit", run.total_cents, expectedTotal);
  check("every line reached the invoice", run.line_count, 4);
  check("this run was not a repeat", run.already_billed, false);

  // ── the credit was actually spent ──────────────────────────────────────────
  const { data: creditAfter } = await sb.from("tenant_credits").select("balance_cents").eq("tenant_id", tenantId).maybeSingle();
  check("the credit balance is drawn down by exactly what was applied", creditAfter?.balance_cents ?? null, 0);

  // ── the pending charge is settled against this invoice ─────────────────────
  const { data: pendingAfter } = await sb.from("pending_charges").select("invoice_id, billed_at").eq("id", pending.id).single();
  check("the pending proration is marked billed", Boolean(pendingAfter.billed_at), true);
  check("it points at the invoice that billed it", pendingAfter.invoice_id, run.invoice_id);

  // ── the invoice itself ─────────────────────────────────────────────────────
  const { data: invoice } = await sb
    .from("platform_invoices")
    .select("number, status, kind, total_cents, discount_cents, period_start, period_end")
    .eq("id", run.invoice_id)
    .single();

  check("it is issued rather than paid — nobody has paid it yet", invoice.status, "issued");
  check("it is a custom invoice", invoice.kind, "custom");
  check("the credit shows as a discount", invoice.discount_cents, 2000);
  ensure("it records which period it covers", invoice.period_start !== null && invoice.period_end !== null,
    "period_start/period_end are null, so the invoice does not say what it is for");

  const { data: lines } = await sb.from("platform_invoice_lines").select("kind, amount_cents, included_qty").eq("invoice_id", run.invoice_id);
  const kinds = (lines ?? []).map((l) => l.kind).sort();
  check("the four line kinds are all present", kinds, ["addon", "credit", "overage", "plan"]);
  const overageLine = (lines ?? []).find((l) => l.kind === "overage");
  ensure("the overage line carries the allowance so the customer can check it",
    overageLine && Number(overageLine.included_qty) === 100,
    `included_qty was ${overageLine?.included_qty}`);

  // ── idempotency: the whole point of the ledger ─────────────────────────────
  console.log("\nRunning the same period again…");
  const { data: again, error: againError } = await sb.rpc("bill_subscription_period", {
    p_subscription_id: subscriptionId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_lines: [{ kind: "addon", label: "Verify seats", quantity: 1, unit_cents: 1500, amount_cents: 1500 }],
    p_pending_ids: [],
    p_reason: "Period billing verification run",
    p_credit_cents: 0,
    p_due_at: null,
    p_created_by: null,
  });
  if (againError) throw new Error(`second run: ${againError.message}`);
  const repeat = Array.isArray(again) ? again[0] : again;

  check("the second run reports the period as already billed", repeat.already_billed, true);
  check("it returns the first invoice rather than raising another", repeat.invoice_id, run.invoice_id);

  const { count } = await sb
    .from("platform_invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  check("exactly one invoice exists for this tenant", count, 1);

  // ── nothing to bill produces no invoice ────────────────────────────────────
  console.log("\nA period with nothing beyond the plan…");
  const emptyStart = new Date(Date.now() - 62 * 86_400_000).toISOString();
  const { data: empty, error: emptyError } = await sb.rpc("bill_subscription_period", {
    p_subscription_id: subscriptionId,
    p_period_start: emptyStart,
    p_period_end: periodStart,
    p_lines: [],
    p_pending_ids: [],
    p_reason: "Period billing verification, empty period",
    p_credit_cents: 0,
    p_due_at: null,
    p_created_by: null,
  });
  if (emptyError) throw new Error(`empty period: ${emptyError.message}`);
  const emptyRun = Array.isArray(empty) ? empty[0] : empty;

  check("no invoice is raised for an empty period", emptyRun.invoice_id, null);

  const { data: ledger } = await sb
    .from("period_billing_runs")
    .select("note")
    .eq("subscription_id", subscriptionId)
    .eq("period_start", emptyStart)
    .single();
  ensure("but the run is still recorded, so it is not re-examined forever",
    Boolean(ledger?.note), "no ledger row was written for the empty period");

  // ── waivers, through the real assembler ────────────────────────────────────
  //
  // Everything above calls the RPC with lines built by hand, which proves the database half. This
  // section calls billSubscriptionPeriod, so the assembler, the waiver query, the RPC and the
  // collection attempt are all exercised as one path — the same one the scheduled job runs.
  console.log("\nA period with an overage waiver…");

  const waivedStart = new Date(Date.now() - 95 * 86_400_000).toISOString();
  const waivedEnd = new Date(Date.now() - 65 * 86_400_000).toISOString();

  await sb.from("subscriptions")
    .update({ current_period_start: waivedStart, current_period_end: waivedEnd })
    .eq("id", subscriptionId);
  await sb.from("usage_totals").insert({ tenant_id: tenantId, meter_key: meterKey, period_start: waivedStart, used_qty: 180 });

  const { error: waiverError } = await sb.from("billing_waivers").insert({
    tenant_id: tenantId,
    subscription_id: subscriptionId,
    meter_key: meterKey,
    period_start: waivedStart,
    max_cents: null,
    reason: "Verification: outage during the period",
  });
  if (waiverError) throw new Error(`waiver: ${waiverError.message}`);

  // A second waiver naming a meter with no overage. It must survive untouched — a waiver burned
  // against nothing is a forgiveness the customer never received and can never use again.
  const { error: idleError } = await sb.from("billing_waivers").insert({
    tenant_id: tenantId,
    subscription_id: subscriptionId,
    meter_key: `${meterKey}_absent_${stamp}`,
    period_start: waivedStart,
    max_cents: 500,
    reason: "Verification: waiver for a meter with no usage",
  });
  if (idleError) throw new Error(`idle waiver: ${idleError.message}`);

  const outcome = await billSubscriptionPeriod(sb, {
    id: subscriptionId,
    tenant_id: tenantId,
    tenant_name: "Period billing verify",
    billing_cycle: "monthly",
    current_period_start: waivedStart,
    current_period_end: waivedEnd,
    status: "active",
  });

  if (outcome.error) throw new Error(`waived run: ${outcome.error}`);
  if (outcome.invoiceId) invoiceIds.push(outcome.invoiceId);

  const expectedWaived = 80 * sellCents;

  check("the run reports the overage as waived", outcome.waivedCents, expectedWaived);
  ensure("the add-on is still billed — a waiver reaches the overage and nothing else",
    outcome.totalCents === 1500,
    `expected the 1500 add-on to remain, got ${outcome.totalCents}`);

  const { data: waivedLines } = await sb
    .from("platform_invoice_lines").select("kind, amount_cents, label").eq("invoice_id", outcome.invoiceId);
  const waivedKinds = (waivedLines ?? []).map((l) => l.kind).sort();
  check("the overage appears AND is discounted, rather than being quietly removed",
    waivedKinds, ["addon", "discount", "overage"]);

  const discountLine = (waivedLines ?? []).find((l) => l.kind === "discount");
  ensure("the waiver line says why it was granted",
    Boolean(discountLine?.label?.includes("outage during the period")),
    `the discount line reads "${discountLine?.label}"`);
  ensure("the waiver is stored as a negative amount, so the lines sum to the total",
    Number(discountLine?.amount_cents) === -expectedWaived,
    `expected ${-expectedWaived}, got ${discountLine?.amount_cents}`);

  const { data: lineSum } = await sb
    .from("platform_invoice_lines").select("amount_cents").eq("invoice_id", outcome.invoiceId);
  const summed = (lineSum ?? []).reduce((total, l) => total + Number(l.amount_cents), 0);
  check("the invoice lines add up to what the invoice asks for", summed, outcome.totalCents);

  // ── the waiver is spent, once, and only the matching one ───────────────────
  const { data: spent } = await sb
    .from("billing_waivers").select("id, meter_key, consumed_at, invoice_id")
    .eq("subscription_id", subscriptionId).eq("period_start", waivedStart);

  const applied = (spent ?? []).find((w) => w.meter_key === meterKey);
  const untouched = (spent ?? []).find((w) => w.id !== applied?.id && w.meter_key !== meterKey);

  ensure("the applied waiver is marked consumed", Boolean(applied?.consumed_at), "consumed_at is null");
  check("it records the invoice it was spent on", applied?.invoice_id, outcome.invoiceId);
  ensure("a waiver matching no overage is left unspent for the period it was meant for",
    untouched !== undefined && untouched.consumed_at === null,
    `consumed_at is ${untouched?.consumed_at}`);
  check("the run reports it rather than dropping it silently", outcome.unusedWaivers.length, 1);

  // ── the invoice was offered for collection ─────────────────────────────────
  //
  // This fixture tenant has no payment provider, so the only honest outcome is a warning. That is
  // the assertion worth making: before backlog 27 was fixed there was no attempt at all, and no
  // warning either — the invoice was simply raised and never sent, which looks identical to
  // success from every angle except the bank.
  ensure("collection was attempted and its outcome recorded",
    outcome.payOnlineUrl !== null || outcome.collectionWarning !== null,
    "neither a pay-online link nor a warning came back, so nothing tried to collect this invoice");
  ensure("a tenant with no payment provider is reported as such, not silently skipped",
    Boolean(outcome.collectionWarning?.includes("provider customer")),
    `the warning read "${outcome.collectionWarning}"`);

  // ── billing it again spends nothing twice ──────────────────────────────────
  const repeatOutcome = await billSubscriptionPeriod(sb, {
    id: subscriptionId, tenant_id: tenantId, tenant_name: "Period billing verify",
    billing_cycle: "monthly", current_period_start: waivedStart, current_period_end: waivedEnd,
    status: "active",
  });
  check("a repeat run finds the period already billed", repeatOutcome.alreadyBilled, true);
  check("and reports no further waiver spend", repeatOutcome.waivedCents, 0);
  ensure("and does not send a second pay page for one debt",
    repeatOutcome.payOnlineUrl === null && repeatOutcome.collectionWarning === null,
    "the repeat run tried to collect again");

  console.log("");
  if (failures === 0) {
    console.log("[32mAll period billing checks passed.[0m");
  } else {
    console.log(`[31m${failures} check(s) failed.[0m`);
  }
} catch (error) {
  console.error(`\n[31m${error instanceof Error ? error.message : String(error)}[0m`);
  failures++;
} finally {
  await cleanup();
}

// exitCode rather than exit(): on Node 24 for Windows, exiting while the Supabase client's sockets
// are still closing trips a libuv assertion and returns 9, which would mask the real result.
process.exitCode = failures > 0 ? 1 : 0;
