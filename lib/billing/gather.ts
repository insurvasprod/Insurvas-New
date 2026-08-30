// The period billing run — the thing #44 says does not exist.
//
// At each rollover it gathers a subscription's attached add-ons, its metered overage above the
// allowance, and any charge parked by an earlier event (a mid-period upgrade above all), applies
// whatever credit the tenant holds, and raises one invoice for the lot.
//
// Ordering matters and is easy to get wrong: this must run BEFORE advance_billing_periods(). Usage
// is keyed by period_start, so once the period rolls, "this period's usage" means the new, empty
// bucket. Billing after the roll would bill every customer for zero overage, every time, and look
// entirely healthy while doing it. scripts/run-period-billing.mjs enforces the order.
//
// Everything that decides an AMOUNT lives in ./lines.ts and is unit-tested. This file only fetches
// and dispatches, so the arithmetic is never guarded by a database connection.
//
// Every function here takes its Supabase client as an argument rather than reaching for the
// service client itself. That is what lets scripts/run-period-billing.mjs exercise the identical
// code path the app uses: `server-only` throws outside a request, so a module that imported the
// service client directly could never be run by the job that most needs to run it, and the two
// would drift into separate implementations of the same billing rules.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
// Explicit .ts extension, and every other import here is type-only. That is what lets
// scripts/run-period-billing.mjs load this module under plain Node: type imports are erased by
// --experimental-strip-types, but a value import still has to resolve, and Node ESM will not guess
// an extension or understand the "@/" alias.
import {
  assemblePeriodInvoice,
  type MeterUsage,
  type MeterPrice,
  type AttachedAddonForBilling,
  type PendingChargeForBilling,
} from "./lines.ts";
import type { BillingCycle } from "@/lib/money";
import type { InvoiceLineKind } from "@/lib/invoices/constants";

/**
 * The service-role client, passed in rather than reached for.
 *
 * Scripts hand this the untyped client they build themselves; nothing checks types in a .mjs file,
 * so both callers work and the app keeps its type safety.
 */
export type Db = SupabaseClient<Database>;

export type DueSubscription = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  billing_cycle: BillingCycle;
  current_period_start: string;
  current_period_end: string;
  status: string;
};

export type PeriodBillingOutcome = {
  subscriptionId: string;
  tenantName: string;
  periodStart: string;
  periodEnd: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  totalCents: number;
  lineCount: number;
  creditAppliedCents: number;
  alreadyBilled: boolean;
  /** Add-ons on a cycle this period does not bill; reported rather than silently dropped. */
  skippedAddons: string[];
  error: string | null;
};

/**
 * Subscriptions whose period has ended and which are still live.
 *
 * `cancelling` is included on purpose. A subscription set to cancel at period end still consumed
 * the period, and its final overage is owed — dropping it would make cancelling the cheapest way to
 * use a metered feature for free.
 */
export async function findDueSubscriptions(supabase: Db, now = new Date()): Promise<DueSubscription[]> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, tenant_id, billing_cycle, current_period_start, current_period_end, status")
    .neq("status", "cancelled")
    .not("current_period_end", "is", null)
    .lte("current_period_end", now.toISOString())
    .order("current_period_end", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((row) => row.current_period_start);
  if (rows.length === 0) return [];

  // Names in a second query rather than an embedded select. The generated types carry no
  // relationships, so a nested `tenants(name)` does not typecheck, and a tenant name is only ever
  // used to make the run's output readable.
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name")
    .in("id", [...new Set(rows.map((r) => r.tenant_id))]);
  const nameOf = new Map((tenants ?? []).map((t) => [t.id, t.name]));

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    tenant_name: nameOf.get(row.tenant_id) ?? row.tenant_id,
    billing_cycle: row.billing_cycle as BillingCycle,
    current_period_start: row.current_period_start as string,
    current_period_end: row.current_period_end as string,
    status: row.status as string,
  }));
}

async function fetchPendingCharges(supabase: Db, subscriptionId: string): Promise<PendingChargeForBilling[]> {
  const { data, error } = await supabase
    .from("pending_charges")
    .select("id, kind, label, quantity, included_qty, unit_cents, amount_cents")
    .eq("subscription_id", subscriptionId)
    .is("billed_at", null)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as InvoiceLineKind,
    label: row.label as string,
    quantity: Number(row.quantity ?? 1),
    includedQty: row.included_qty === null ? null : Number(row.included_qty),
    unitCents: Number(row.unit_cents ?? 0),
    amountCents: Number(row.amount_cents),
  }));
}

async function fetchAttachedAddons(supabase: Db, subscriptionId: string): Promise<AttachedAddonForBilling[]> {
  // `detached_at is null` is load-bearing. Without it an add-on the customer cancelled keeps
  // appearing on every future invoice, which is the kind of billing error people leave over.
  const { data: attached, error } = await supabase
    .from("subscription_addons")
    .select("addon_id")
    .eq("subscription_id", subscriptionId)
    .is("detached_at", null);

  if (error) throw new Error(error.message);
  const ids = (attached ?? []).map((a) => a.addon_id);
  if (ids.length === 0) return [];

  const { data: addons, error: addonError } = await supabase
    .from("addons")
    .select("id, code, name, price_cents, billing_cycle")
    .in("id", ids);

  if (addonError) throw new Error(addonError.message);

  return (addons ?? []).map((a) => ({
    code: a.code,
    name: a.name,
    priceCents: a.price_cents,
    billingCycle: a.billing_cycle as BillingCycle,
  }));
}

/**
 * Usage for the period being billed, from the same function the Configuration Center reads.
 *
 * Reusing `admin_usage_monitor` rather than re-deriving allowances is the point: it already knows
 * that a plan's included quantity beats the platform default, and that credit grants add to it.
 * A second implementation of that precedence would eventually disagree with the screen an operator
 * is looking at, and the customer would be billed by the one nobody could see.
 */
async function fetchUsage(supabase: Db, tenantId: string, periodStart: string): Promise<MeterUsage[]> {
  const { data, error } = await supabase.rpc("admin_usage_monitor", { p_over_80: false });
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row: { tenant_id: string; period_start: string | null }) =>
      row.tenant_id === tenantId && row.period_start === periodStart)
    .map((row: {
      meter_key: string; meter_label: string; unit: string;
      used_qty: number; included_qty: number | null; hard_cap: boolean;
    }) => ({
      meterKey: row.meter_key,
      label: row.meter_label,
      unit: row.unit,
      usedQty: row.used_qty ?? 0,
      includedQty: row.included_qty,
      hardCap: row.hard_cap ?? true,
    }));
}

async function fetchMeterPricing(supabase: Db): Promise<MeterPrice[]> {
  const { data, error } = await supabase.from("meter_pricing").select("meter_key, sell_cents");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ meterKey: r.meter_key as string, sellCents: r.sell_cents as number }));
}

async function fetchCreditBalance(supabase: Db, tenantId: string): Promise<number> {
  const { data } = await supabase
    .from("tenant_credits")
    .select("balance_cents")
    .eq("tenant_id", tenantId)
    .maybeSingle<{ balance_cents: number }>();
  return data?.balance_cents ?? 0;
}

/** How long a customer gets to pay. Deliberately generous — this is a bill they did not choose. */
const DUE_DAYS = 14;

/**
 * Bill one subscription for the period that has ended.
 *
 * Idempotent by the ledger in `period_billing_runs`, not by anything checked here — a check in
 * TypeScript would race two concurrent runs, whereas the primary key cannot.
 */
export async function billSubscriptionPeriod(
  supabase: Db,
  subscription: DueSubscription,
  options?: { createdBy?: string | null },
): Promise<PeriodBillingOutcome> {
  const base = {
    subscriptionId: subscription.id,
    tenantName: subscription.tenant_name,
    periodStart: subscription.current_period_start,
    periodEnd: subscription.current_period_end,
  };

  try {
    const [pending, addons, usage, pricing, creditBalanceCents] = await Promise.all([
      fetchPendingCharges(supabase, subscription.id),
      fetchAttachedAddons(supabase, subscription.id),
      fetchUsage(supabase, subscription.tenant_id, subscription.current_period_start),
      fetchMeterPricing(supabase),
      fetchCreditBalance(supabase, subscription.tenant_id),
    ]);

    const assembled = assemblePeriodInvoice({
      pending,
      addons,
      cycle: subscription.billing_cycle,
      usage,
      pricing,
      creditBalanceCents,
    });

    const periodLabel = new Date(subscription.current_period_start).toISOString().slice(0, 10);
    const dueAt = new Date(Date.now() + DUE_DAYS * 86_400_000).toISOString();

      const { data, error } = await supabase.rpc("bill_subscription_period", {
      p_subscription_id: subscription.id,
      p_period_start: subscription.current_period_start,
      p_period_end: subscription.current_period_end,
      p_lines: assembled.lines,
      p_pending_ids: assembled.pendingIds,
      p_reason: `Usage and add-ons for the period beginning ${periodLabel}`,
      p_credit_cents: assembled.creditAppliedCents,
      p_due_at: dueAt,
      p_created_by: options?.createdBy ?? null,
    });

    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;

    return {
      ...base,
      invoiceId: row?.invoice_id ?? null,
      invoiceNumber: row?.invoice_number ?? null,
      totalCents: row?.total_cents ?? 0,
      lineCount: row?.line_count ?? 0,
      // An already-billed period spent no credit on this run, whatever the assembly computed.
      creditAppliedCents: row?.already_billed ? 0 : assembled.creditAppliedCents,
      alreadyBilled: Boolean(row?.already_billed),
      skippedAddons: assembled.skippedAddons.map((a) => a.name),
      error: null,
    };
  } catch (error) {
    // One tenant's failure must not stop the run. A thrown error here would leave every later
    // subscription unbilled, and the next run would find the same first failure and stop again.
    return {
      ...base,
      invoiceId: null,
      invoiceNumber: null,
      totalCents: 0,
      lineCount: 0,
      creditAppliedCents: 0,
      alreadyBilled: false,
      skippedAddons: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runPeriodBilling(
  supabase: Db,
  options?: { now?: Date; createdBy?: string | null },
): Promise<PeriodBillingOutcome[]> {
  const due = await findDueSubscriptions(supabase, options?.now);
  const outcomes: PeriodBillingOutcome[] = [];
  // Sequential rather than parallel: each call locks its subscription row and writes invoice
  // numbers from a shared sequence, and a stampede of those buys nothing on a list this size.
  for (const subscription of due) {
    outcomes.push(await billSubscriptionPeriod(supabase, subscription, { createdBy: options?.createdBy }));
  }
  return outcomes;
}
