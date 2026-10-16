import "server-only";

// LA-8.5 (Notion sprint, Module 8 — Settings) · Subscription self-service: what the agency owner
// sees on Settings › Plan & billing, and the changes they can make there.
//
// Owns NO pricing, proration or entitlement logic (asserted by selfService.test.mjs). Every figure
// comes from SA-2/SA-3: prices and the proration preview from lib/billing/planChange.ts, usage from
// check_meter_capacity, limits and access from the cached entitlement, and every change goes through
// the same SA-2 functions the admin console calls (admin_change_subscription_plan,
// admin_set_subscription_pause_state, admin_cancel_subscription), followed by the same entitlement
// rebuild and settlement.

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { checkMeterCapacity } from "@/lib/metering/enforce";
import { outboundLimitSnapshot } from "@/lib/metering/outbound";
import { fetchTenantSeatsHeld } from "@/lib/subscriptions/tenantBilling";
import { listPartners } from "@/lib/partners/service";
import { planPriceCents, previewPlanChange, settleMidPeriodPlanChange, type PlanChangePreview } from "@/lib/billing/planChange";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";
import { buildProvider } from "@/lib/payments/registry";
import { WhopProvider } from "@/lib/payments/whop/provider";
import { cancelledRetentionDays, meterWarnThreshold } from "@/lib/settings/queries";
import type { BillingCycle } from "@/lib/money";
import type { Entitlement } from "@/lib/entitlements/types";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import type { InvoiceStatus } from "@/lib/invoices/constants";
import {
  BILLING_STATE_COPY,
  dunningView,
  nextAttemptFromPayload,
  retentionEndsAt,
  retrySchedule,
  selfServeActions,
  usageTier,
  type DunningView,
  type ProviderFailure,
  type RetrySchedule,
  type SelfServeActions,
  type UsageTier,
} from "./selfServiceRules";

const db = () => getSupabaseServiceClient();
// Untyped, for tables and functions not in the generated types (the record counts, plan_and_addon_feature_keys).
const untyped = () => getSupabaseServiceClient() as unknown as SupabaseClient;
// Loosely typed: subscriptions.pause_offered_at (20261015330000) is not in the generated types yet.
type Loose = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        order(column: string, options: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> };
      };
    };
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): { is(column: string, value: null): PromiseLike<{ error: { message: string } | null }> } };
  };
};
const loose = () => getSupabaseServiceClient() as unknown as Loose;

export type BillingSubscription = {
  id: string;
  plan_id: string;
  pending_plan_id: string | null;
  status: SubscriptionStatus;
  billing_cycle: BillingCycle;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  whop_membership_id: string | null;
  last_provider_event_at: string | null;
  pause_offered_at: string | null;
};

const SUB_COLUMNS = "id, plan_id, pending_plan_id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, whop_membership_id, last_provider_event_at, started_at";

/**
 * The subscription the entitlement engine reads: the newest live one, else the newest cancelled one
 * (refresh_tenant_entitlement orders the same way). fetchTenantSubscription skips cancelled ones, and
 * a cancelled agency must still see its plan, its retention date and its invoices.
 */
export async function currentSubscription(tenantId: string): Promise<{ subscription: BillingSubscription | null; schemaReady: boolean }> {
  const read = (columns: string) =>
    loose().from("subscriptions").select(columns).eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(50);
  let schemaReady = true;
  let result = await read(`${SUB_COLUMNS}, pause_offered_at`);
  if (result.error && /pause_offered_at/.test(result.error.message)) {
    schemaReady = false;
    result = await read(SUB_COLUMNS);
  }
  if (result.error) throw new Error(`Could not read the subscription: ${result.error.message}`);
  const rows = (result.data ?? []) as (BillingSubscription & { pause_offered_at?: string | null })[];
  const pick = rows.find((r) => r.status !== "cancelled") ?? rows[0] ?? null;
  return { subscription: pick ? { ...pick, pause_offered_at: pick.pause_offered_at ?? null } : null, schemaReady };
}

/* ── the view ──────────────────────────────────────────────────────────── */

export type LimitRow = {
  key: string;
  label: string;
  used: number;
  limit: number | null;
  tier: UsageTier;
  /** Metered limits reset each billing period; counted ones (seats, partners) do not. */
  metered: boolean;
  resetsAt: string | null;
  hardCap: boolean;
};

export type BillingInvoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  payOnlineUrl: string | null;
};

export type PlanOption = { id: string; name: string; priceCents: number; applyNow: boolean };

export type BillingView = {
  schemaReady: boolean;
  subscription: null | {
    id: string;
    status: SubscriptionStatus;
    statusLabel: string;
    cycle: BillingCycle;
    periodStart: string | null;
    periodEnd: string | null;
    /** The next charge date; null once it will not renew (cancelling, cancelled, paused). */
    renewsAt: string | null;
    trialEndsAt: string | null;
    pendingPlanName: string | null;
    cancelledAt: string | null;
  };
  plan: null | { id: string; name: string; priceCents: number | null; features: { key: string; label: string }[]; addons: { name: string; priceCents: number; cycle: BillingCycle }[] };
  limits: LimitRow[];
  warnPercent: number;
  invoices: BillingInvoice[];
  dunning: DunningView;
  retention: { days: number; endsAt: string | null };
  actions: SelfServeActions | null;
  /** True when the card lives with Whop (a membership exists); otherwise invoices are paid by link. */
  cardOnFile: boolean;
  /**
   * Whop cannot switch a membership's plan, and SA-3's settlement stops the old membership renewing,
   * so a card-billed agency changing plan here would lose access at renewal (LA-5 audit, 2026-10-15).
   * Until a new-plan checkout exists, its plan changes go through support.
   */
  planChangeBySupport: boolean;
  options: PlanOption[];
};

async function featureLabels(keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const { data } = await db().from("features").select("feature_key, label").in("feature_key", keys);
  return new Map(((data ?? []) as { feature_key: string; label: string }[]).map((f) => [f.feature_key, f.label]));
}

/** Every limit the plan sets, with what the agency uses of it now. Unlimited ones are left out. */
async function limitRows(tenantId: string, entitlement: Entitlement, sub: BillingSubscription | null, warn: number): Promise<LimitRow[]> {
  const rows: LimitRow[] = [];
  const resetsAt = sub?.current_period_end ?? null;
  const meterKeys = Object.keys(entitlement.meters ?? {});
  const [meterLabels, live, seatsHeld, outbound, partners] = await Promise.all([
    meterKeys.length ? db().from("meters").select("meter_key, label").in("meter_key", meterKeys) : Promise.resolve({ data: [] }),
    Promise.all(meterKeys.map(async (key) => {
      try { return [key, await checkMeterCapacity(tenantId, key, 0)] as const; } catch { return [key, null] as const; }
    })),
    entitlement.limits.max_seats != null ? fetchTenantSeatsHeld(tenantId) : Promise.resolve(0),
    outboundLimitSnapshot(tenantId).catch(() => []),
    listPartners(tenantId).catch(() => []),
  ]);
  const label = new Map(((meterLabels.data ?? []) as { meter_key: string; label: string }[]).map((m) => [m.meter_key, m.label]));

  for (const [key, check] of live) {
    const snapshot = entitlement.meters[key];
    const used = Number(check?.used ?? snapshot?.used ?? 0);
    const limit = check ? check.included : snapshot?.included ?? null;
    if (limit === null) continue;
    rows.push({ key, label: label.get(key) ?? key, used, limit, tier: usageTier(used, limit, warn), metered: true, resetsAt, hardCap: Boolean(check?.hard_cap ?? snapshot?.hard_cap) });
  }
  const counted = (key: string, labelText: string, used: number, limit: number | null | undefined) => {
    if (limit == null) return;
    rows.push({ key, label: labelText, used, limit, tier: usageTier(used, limit, warn), metered: false, resetsAt: null, hardCap: true });
  };
  counted("max_seats", "Seats", seatsHeld, entitlement.limits.max_seats);
  const active = (type: string) => partners.filter((p) => p.partner_type === type && p.status === "active").length;
  counted("max_publishers", "Publishers", active("publisher"), entitlement.limits.max_publishers);
  counted("max_marketing_partners", "Marketing companies", active("marketing"), entitlement.limits.max_marketing_partners);
  counted("max_affiliates", "Affiliates", active("affiliate"), entitlement.limits.max_affiliates);
  counted("max_partner_users", "Partner users", partners.filter((p) => p.status === "active").reduce((sum, p) => sum + (p.active_user_count ?? 0), 0), entitlement.limits.max_partner_users);
  for (const o of outbound) {
    if (o.key === "max_setter_seats") counted(o.key, "Setter seats", o.usage, o.limit);
    if (o.key === "max_active_campaigns") counted(o.key, "Active campaigns", o.usage, o.limit);
  }
  return rows;
}

/** When the card first failed since it last went through — the start of Whop's retry window. */
async function retryScheduleSinceLastSuccess(tenantId: string): Promise<RetrySchedule> {
  const { data } = await db()
    .from("webhook_events")
    .select("event_type, occurred_at, received_at, payload")
    .eq("tenant_id", tenantId)
    .in("event_type", ["payment.succeeded", "payment.failed", "invoice.past_due"])
    .order("received_at", { ascending: false })
    .limit(50);
  // Newest first, back to the last success: every payment.failed is one attempt Whop made.
  const attempts: ProviderFailure[] = [];
  let pastDueAt: string | null = null;
  for (const e of (data ?? []) as { event_type: string; occurred_at: string | null; received_at: string; payload: unknown }[]) {
    if (e.event_type === "payment.succeeded") break;
    const at = e.occurred_at ?? e.received_at;
    if (e.event_type === "payment.failed") attempts.push({ at, nextAttemptAt: nextAttemptFromPayload(e.payload) });
    else pastDueAt = at;
  }
  // An invoice that went past due with no failed payment on record still dates the failure.
  if (!attempts.length && pastDueAt) attempts.push({ at: pastDueAt, nextAttemptAt: null });
  return retrySchedule(attempts);
}

/** Plans the agency can move to: public, sellable, the newest version of each, priced on its cycle. */
async function planOptions(sub: BillingSubscription): Promise<PlanOption[]> {
  const { data: current } = await db().from("plans").select("code, plan_type").eq("id", sub.plan_id).maybeSingle<{ code: string; plan_type: string }>();
  const { data } = await db().from("plans").select("id, code, version, name, plan_type, sort_order").eq("is_public", true).eq("is_archived", false).order("version", { ascending: false });
  const newest = new Map<string, { id: string; code: string; name: string; plan_type: string; sort_order: number }>();
  for (const p of (data ?? []) as { id: string; code: string; version: number; name: string; plan_type: string; sort_order: number }[]) {
    if (!newest.has(p.code)) newest.set(p.code, p);
  }
  // Same kind of plan only: an agency with teams is not offered a single-seat plan, and back.
  const candidates = [...newest.values()].filter((p) => p.id !== sub.plan_id && (!current || p.plan_type === current.plan_type));
  const options = await Promise.all(candidates.map(async (p) => {
    const preview = await previewPlanChange({ subscriptionId: sub.id, fromPlanId: sub.plan_id, toPlanId: p.id });
    return preview?.newPriceCents != null ? { id: p.id, name: p.name, priceCents: preview.newPriceCents, applyNow: preview.applyNow, sort: p.sort_order } : null;
  }));
  return options.filter((o): o is PlanOption & { sort: number } => o !== null).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents, applyNow: o.applyNow }));
}

export async function loadBillingView(tenantId: string, entitlement: Entitlement): Promise<BillingView> {
  const [{ subscription: sub, schemaReady }, warn, retentionDays] = await Promise.all([currentSubscription(tenantId), meterWarnThreshold(), cancelledRetentionDays()]);

  const invoicesRead = db()
    .from("platform_invoices")
    .select("id, number, status, total_cents, period_start, period_end, issued_at, due_at, paid_at, pay_online_url")
    .eq("tenant_id", tenantId)
    .neq("status", "draft")
    .order("number", { ascending: false })
    .limit(100);

  const [limits, invoices, schedule] = await Promise.all([
    limitRows(tenantId, entitlement, sub, warn),
    invoicesRead,
    sub?.status === "past_due" ? retryScheduleSinceLastSuccess(tenantId) : Promise.resolve(null),
  ]);
  if (invoices.error) throw new Error(`Could not read invoices: ${invoices.error.message}`);
  const invoiceRows: BillingInvoice[] = ((invoices.data ?? []) as {
    id: string; number: string; status: InvoiceStatus; total_cents: number; period_start: string | null; period_end: string | null;
    issued_at: string | null; due_at: string | null; paid_at: string | null; pay_online_url: string | null;
  }[]).map((r) => ({ id: r.id, number: r.number, status: r.status, totalCents: r.total_cents, periodStart: r.period_start, periodEnd: r.period_end, issuedAt: r.issued_at, dueAt: r.due_at, paidAt: r.paid_at, payOnlineUrl: r.pay_online_url }));

  const base = { schemaReady, limits, warnPercent: Math.round(warn * 100), invoices: invoiceRows };
  if (!sub) {
    return { ...base, subscription: null, plan: null, dunning: null, retention: { days: retentionDays, endsAt: null }, actions: null, cardOnFile: false, planChangeBySupport: false, options: [] };
  }

  const [planRow, pendingRow, priceCents, addonRows, options] = await Promise.all([
    db().from("plans").select("id, name").eq("id", sub.plan_id).maybeSingle<{ id: string; name: string }>(),
    sub.pending_plan_id ? db().from("plans").select("name").eq("id", sub.pending_plan_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
    planPriceCents(sub.plan_id, sub.billing_cycle),
    db().from("subscription_addons").select("addons(name, price_cents, billing_cycle)").eq("subscription_id", sub.id).is("detached_at", null),
    !sub.whop_membership_id && (sub.status === "trialing" || sub.status === "active" || sub.status === "past_due") ? planOptions(sub) : Promise.resolve([]),
  ]);
  const featureKeys = entitlement.features ?? [];
  const labels = await featureLabels(featureKeys);
  const ends = sub.status === "cancelled" ? sub.cancelled_at : sub.status === "cancelling" ? sub.current_period_end : null;
  const renews = sub.status === "trialing" || sub.status === "active" || sub.status === "past_due";

  return {
    ...base,
    subscription: {
      id: sub.id,
      status: sub.status,
      statusLabel: BILLING_STATE_COPY[sub.status],
      cycle: sub.billing_cycle,
      periodStart: sub.current_period_start,
      periodEnd: sub.current_period_end,
      renewsAt: renews ? (sub.status === "trialing" ? sub.trial_ends_at ?? sub.current_period_end : sub.current_period_end) : null,
      trialEndsAt: sub.trial_ends_at,
      // A queued change only means something while the subscription will renew into it.
      pendingPlanName: renews ? pendingRow.data?.name ?? null : null,
      cancelledAt: sub.cancelled_at,
    },
    plan: {
      id: sub.plan_id,
      name: planRow.data?.name ?? "Your plan",
      priceCents,
      features: featureKeys.map((key) => ({ key, label: labels.get(key) ?? key })).sort((a, b) => a.label.localeCompare(b.label)),
      addons: ((addonRows.data ?? []) as unknown as { addons: { name: string; price_cents: number; billing_cycle: BillingCycle } | null }[])
        .flatMap((r) => (r.addons ? [{ name: r.addons.name, priceCents: r.addons.price_cents, cycle: r.addons.billing_cycle }] : [])),
    },
    dunning: dunningView(sub.status, schedule, sub.status === "suspended" ? sub.last_provider_event_at : null),
    retention: { days: retentionDays, endsAt: ends ? retentionEndsAt(ends, retentionDays) : null },
    actions: selfServeActions(sub.status, sub.pause_offered_at),
    cardOnFile: Boolean(sub.whop_membership_id),
    planChangeBySupport: Boolean(sub.whop_membership_id),
    options,
  };
}

/* ── what a downgrade takes away, counted from the agency's own records ── */

/**
 * For a feature the agency would lose, the records of its own that the feature's screens hold. The
 * records are not deleted by a downgrade; they stop being reachable until the feature comes back.
 */
const FEATURE_RECORDS: Record<string, { table: string; noun: [string, string]; filter?: (q: CountQuery) => CountQuery }> = {
  book_of_business: { table: "tenant_policies", noun: ["policy in your book", "policies in your book"] },
  statement_ingestion: { table: "tenant_commission_statements", noun: ["carrier statement", "carrier statements"], filter: (q) => q.is("voided_at", null) },
  commission_ledger: { table: "tenant_commission_statement_lines", noun: ["commission line", "commission lines"] },
  discrepancy_report: { table: "tenant_commission_discrepancies", noun: ["commission discrepancy", "commission discrepancies"] },
  chargeback_radar: { table: "tenant_policy_lapse_signals", noun: ["lapse-risk signal", "lapse-risk signals"] },
  payment_repair: { table: "save_attempt", noun: ["save attempt", "save attempts"] },
  winback: { table: "winback_candidate", noun: ["win-back candidate", "win-back candidates"] },
  applications: { table: "tenant_application_cases", noun: ["application case", "application cases"] },
  outbound_dialing: { table: "tenant_campaigns", noun: ["campaign", "campaigns"] },
  callback_calendar: { table: "tenant_callbacks", noun: ["callback", "callbacks"] },
  quoting: { table: "tenant_quotes", noun: ["quote", "quotes"] },
  consent_locker: { table: "tenant_consent_artefacts", noun: ["consent certificate", "consent certificates"] },
  publisher_records: { table: "partners", noun: ["partner", "partners"] },
  payout_runs: { table: "payout_run", noun: ["payout run", "payout runs"], filter: (q) => q.is("voided_at", null) },
  appointment_vault: { table: "licenses", noun: ["licence on file", "licences on file"] },
  profit_and_loss: { table: "expense", noun: ["expense", "expenses"], filter: (q) => q.is("voided_at", null) },
};
type CountQuery = { is(column: string, value: null): CountQuery; eq(column: string, value: string): CountQuery } & PromiseLike<{ count: number | null; error: { message: string } | null }>;

export type DowngradeImpact = {
  plan: { id: string; name: string };
  preview: PlanChangePreview | null;
  /** When the change happens: now for an upgrade, the period's end for a downgrade (SA-2's rule). */
  effectiveAt: string | null;
  featuresLost: { key: string; label: string; records: string | null }[];
  limitsOver: { key: string; label: string; used: number; newLimit: number }[];
};

const LIMIT_KEYS: { key: keyof Entitlement["limits"]; label: string }[] = [
  { key: "max_seats", label: "Seats" },
  { key: "max_publishers", label: "Publishers" },
  { key: "max_marketing_partners", label: "Marketing companies" },
  { key: "max_affiliates", label: "Affiliates" },
  { key: "max_partner_users", label: "Partner users" },
  { key: "max_setter_seats", label: "Setter seats" },
  { key: "max_active_campaigns", label: "Active campaigns" },
];

export async function planChangeImpact(tenantId: string, entitlement: Entitlement, toPlanId: string): Promise<DowngradeImpact | { error: string }> {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub) return { error: "There is no subscription to change." };
  const [{ data: plan }, preview, granted, { data: limits }, warn] = await Promise.all([
    db().from("plans").select("id, name, is_public, is_archived").eq("id", toPlanId).maybeSingle<{ id: string; name: string; is_public: boolean; is_archived: boolean }>(),
    previewPlanChange({ subscriptionId: sub.id, fromPlanId: sub.plan_id, toPlanId }),
    untyped().rpc("plan_and_addon_feature_keys", { p_plan_id: toPlanId, p_subscription_id: sub.id }),
    db().from("plan_limits").select("*").eq("plan_id", toPlanId).maybeSingle<Record<string, number | null>>(),
    meterWarnThreshold(),
  ]);
  if (!plan || !plan.is_public || plan.is_archived) return { error: "That plan is not available." };
  if (granted.error) throw new Error(`Could not read the plan's features: ${granted.error.message}`);

  const next = new Set((granted.data as unknown as string[] | null) ?? []);
  const lost = (entitlement.features ?? []).filter((key) => !next.has(key));
  const labels = await featureLabels(lost);
  const featuresLost = await Promise.all(lost.map(async (key) => {
    const spec = FEATURE_RECORDS[key];
    let records: string | null = null;
    if (spec) {
      let q = untyped().from(spec.table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId) as unknown as CountQuery;
      if (spec.filter) q = spec.filter(q);
      const { count, error } = await q;
      if (!error && count) records = `${count.toLocaleString("en-US")} ${count === 1 ? spec.noun[0] : spec.noun[1]}`;
    }
    return { key, label: labels.get(key) ?? key, records };
  }));

  const now = await limitRows(tenantId, entitlement, sub, warn);
  const limitsOver = LIMIT_KEYS.flatMap(({ key, label }) => {
    const newLimit = limits ? (limits[key] ?? null) : null;
    const used = now.find((r) => r.key === key)?.used;
    return newLimit !== null && used !== undefined && used > newLimit ? [{ key, label, used, newLimit }] : [];
  });

  return {
    plan: { id: plan.id, name: plan.name },
    preview,
    effectiveAt: preview?.applyNow ? new Date().toISOString() : sub.current_period_end,
    featuresLost: featuresLost.sort((a, b) => Number(Boolean(b.records)) - Number(Boolean(a.records)) || a.label.localeCompare(b.label)),
    limitsOver,
  };
}

/* ── the changes, through SA-2 ─────────────────────────────────────────── */

export class BillingActionError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** Best effort on the provider, as settleMidPeriodPlanChange does: our side is the record. */
async function onProvider(tenantId: string, membershipId: string | null, act: (p: WhopProvider, id: string) => Promise<void>): Promise<string | null> {
  if (!membershipId) return null;
  try {
    const provider = buildProvider("whop", { tenantId });
    if (provider instanceof WhopProvider) await act(provider, membershipId);
    return null;
  } catch (e) {
    return `The payment provider was not updated: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function selfChangePlan(tenantId: string, actorId: string, toPlanId: string) {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub) throw new BillingActionError("There is no subscription to change.", 409);
  if (!selfServeActions(sub.status, sub.pause_offered_at).canChangePlan) throw new BillingActionError(`A ${sub.status} subscription cannot change plan here.`, 409);
  if (toPlanId === sub.plan_id) throw new BillingActionError("That is already your plan.", 409);
  if (sub.whop_membership_id) throw new BillingActionError("Your card is billed through Whop, which cannot switch a plan on an existing membership. Email support@insurvas.com and we will move you without a gap.", 409, "plan_change_by_support");
  const options = await planOptions(sub);
  const option = options.find((o) => o.id === toPlanId);
  if (!option) throw new BillingActionError("That plan is not available on your billing cycle.", 409);

  const { data, error } = await db().rpc("admin_change_subscription_plan", { p_subscription_id: sub.id, p_new_plan_id: toPlanId, p_apply_now: option.applyNow });
  if (error) {
    if (/plan_archived|plan_not_found|cycle_not_offered/.test(error.message ?? "")) throw new BillingActionError("That plan is not available on your billing cycle.", 409);
    throw new Error(`Could not change the plan: ${error.message}`);
  }
  const result = (Array.isArray(data) ? data[0] : data) as { applied_now: boolean; effective_at: string };
  if (result.applied_now) await rebuildEntitlement(tenantId, "subscription.plan_changed");
  const proration = result.applied_now
    ? await settleMidPeriodPlanChange({ subscriptionId: sub.id, fromPlanId: sub.plan_id, toPlanId, createdBy: actorId })
    : null;
  const { data: fromPlan } = await db().from("plans").select("name").eq("id", sub.plan_id).maybeSingle<{ name: string }>();
  return { subscriptionId: sub.id, fromPlanId: sub.plan_id, toPlanId, fromPlanName: fromPlan?.name ?? null, toPlanName: option.name, appliedNow: result.applied_now, effectiveAt: result.effective_at, proration };
}

async function markPauseOffered(subscriptionId: string) {
  // Stamped once, whatever the owner chose; a missing column (migration not applied) is not fatal here
  // because the routes refuse to run before it is.
  await loose().from("subscriptions").update({ pause_offered_at: new Date().toISOString() }).eq("id", subscriptionId).is("pause_offered_at", null);
}

export async function selfPause(tenantId: string) {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub) throw new BillingActionError("There is no subscription to pause.", 409);
  const { error } = await db().rpc("admin_set_subscription_pause_state", { p_subscription_id: sub.id, p_pause: true });
  if (error) {
    if (error.code === "23514" || /cannot be paused/.test(error.message)) throw new BillingActionError(error.message, 409);
    throw new Error(`Could not pause: ${error.message}`);
  }
  await markPauseOffered(sub.id);
  await rebuildEntitlement(tenantId, "subscription.paused");
  const providerWarning = await onProvider(tenantId, sub.whop_membership_id, (p, id) => p.pauseMembership(id));
  return { subscriptionId: sub.id, from: sub.status, providerWarning };
}

export async function selfResume(tenantId: string) {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub) throw new BillingActionError("There is no subscription to resume.", 409);
  const { error } = await db().rpc("admin_set_subscription_pause_state", { p_subscription_id: sub.id, p_pause: false });
  if (error) {
    if (error.code === "23514" || /can be resumed/.test(error.message)) throw new BillingActionError(error.message, 409);
    throw new Error(`Could not resume: ${error.message}`);
  }
  await rebuildEntitlement(tenantId, "subscription.resumed");
  const providerWarning = await onProvider(tenantId, sub.whop_membership_id, (p, id) => p.resumeMembership(id));
  return { subscriptionId: sub.id, from: sub.status, providerWarning };
}

/**
 * Cancel at the end of the period. The pause is offered first, once: until it has been, the request is
 * refused with `offer_pause` and the screen shows the offer; declining it sends `pause_declined`.
 */
export async function selfCancel(tenantId: string, reason: string, pauseDeclined: boolean) {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub) throw new BillingActionError("There is no subscription to cancel.", 409);
  const actions = selfServeActions(sub.status, sub.pause_offered_at);
  if (!actions.canCancel) throw new BillingActionError(`A ${sub.status} subscription cannot be cancelled here.`, 409);
  // The server shows the offer and records that it did; a client cannot skip it by claiming it declined.
  if (actions.offerPauseFirst) {
    await markPauseOffered(sub.id);
    throw new BillingActionError("Pausing keeps your records and your plan. Pause instead?", 409, "offer_pause");
  }
  void pauseDeclined; // kept in the request for the audit row: the owner chose to cancel after the offer

  const { data, error } = await db().rpc("admin_cancel_subscription", { p_subscription_id: sub.id, p_reason: reason, p_immediate: false });
  if (error) {
    if (/subscription_state_not_cancellable/.test(error.message ?? "")) throw new BillingActionError("That subscription cannot be cancelled in its current state.", 409);
    throw new Error(`Could not cancel: ${error.message}`);
  }
  const result = (Array.isArray(data) ? data[0] : data) as { cancelled_now: boolean; effective_at: string };
  if (result.cancelled_now) await rebuildEntitlement(tenantId, "subscription.cancelled");
  const providerWarning = await onProvider(tenantId, sub.whop_membership_id, (p, id) => p.setCancelAtPeriodEnd(id, true));
  const retentionDays = await cancelledRetentionDays();
  return { subscriptionId: sub.id, from: sub.status, effectiveAt: result.effective_at, retentionEndsAt: retentionEndsAt(result.effective_at, retentionDays), providerWarning };
}

/** Whop's own page for the card on this agency's membership, or null when there is none. */
export async function paymentMethodUrl(tenantId: string): Promise<string | null> {
  const { subscription: sub } = await currentSubscription(tenantId);
  if (!sub?.whop_membership_id) return null;
  const provider = buildProvider("whop", { tenantId });
  if (!(provider instanceof WhopProvider)) return null;
  return provider.membershipManageUrl(sub.whop_membership_id);
}
