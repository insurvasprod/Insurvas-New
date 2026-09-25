import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { meterWarnThreshold } from "@/lib/settings/queries";
import { heldSeat, seatLimitFor } from "@/lib/tenantTeam/seats";
import {
  CREDIT_METER_KEYS,
  type CreditMeterKey,
  type CreditPack,
  type CreditTenant,
  type CreditsLimitsData,
  type DefaultLimitPlan,
  type DefaultLimitRow,
  type DefaultLimits,
  type MeterPricing,
  type SeatMonitorRow,
  type UsageMonitorRow,
} from "./constants";
import { isWatchable, limitState, proximity } from "./present";

export type { CreditsLimitsData } from "./constants";

type CreditPackInput = {
  name: string;
  meter_key: CreditMeterKey;
  quantity: number;
  price_cents: number;
  is_active?: boolean;
};

type Db = ReturnType<typeof getSupabaseServiceClient>;
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** PostgREST caps a response at 1,000 rows; every cross-tenant read here pages until it runs out. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await page(offset, offset + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return all;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const LIVE_ADDON_STATUSES = new Set(["trialing", "active", "past_due", "cancelling"]);

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  started_at: string | null;
  created_at: string | null;
  current_period_start: string | null;
};

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY);

/**
 * The subscription picks check_meter_capacity makes (20260912500000), in one place:
 *   plan / period — tenant_current_plan / tenant_current_period_start: not cancelled, newest started_at;
 *   add-ons      — status trialing|active|past_due|cancelling, newest created_at.
 * A tenant with no plan has no finite allowance anywhere, so it has no monitor rows.
 */
function pickSubscriptions(subscriptions: readonly SubscriptionRow[]) {
  const plan = new Map<string, SubscriptionRow>();
  const addons = new Map<string, SubscriptionRow>();
  for (const sub of subscriptions) {
    if (sub.status !== "cancelled") {
      const current = plan.get(sub.tenant_id);
      if (!current || time(sub.started_at) > time(current.started_at)) plan.set(sub.tenant_id, sub);
    }
    if (LIVE_ADDON_STATUSES.has(sub.status)) {
      const current = addons.get(sub.tenant_id);
      if (!current || time(sub.created_at) > time(current.created_at)) addons.set(sub.tenant_id, sub);
    }
  }
  return { plan, addons };
}

/** tenant_current_period_start's fallback: the calendar month, in UTC. */
function monthStartUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function loadTenants(supabase: Db) {
  return readAll<{ id: string; name: string; status: string }>((from, to) =>
    supabase.from("tenants").select("id, name, status").order("created_at", { ascending: true }).range(from, to),
  );
}

async function loadSubscriptions(supabase: Db) {
  return readAll<SubscriptionRow>((from, to) =>
    supabase
      .from("subscriptions")
      .select("id, tenant_id, plan_id, status, started_at, created_at, current_period_start")
      .order("id")
      .range(from, to) as unknown as PromiseLike<PageResult<SubscriptionRow>>,
  );
}

export async function listCreditPacks(): Promise<CreditPack[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .order("is_active", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditPack[];
}

export async function listMeterPricing(): Promise<MeterPricing[]> {
  const supabase = getSupabaseServiceClient();
  const [{ data: meters, error: metersError }, { data: rows, error: pricingError }, { data: vendors }] = await Promise.all([
    supabase.from("meters").select("meter_key").in("meter_key", [...CREDIT_METER_KEYS]).order("sort_order"),
    supabase.from("meter_pricing").select("meter_key, cost_cents, sell_cents, default_included, updated_at"),
    supabase.from("compliance_vendors").select("cost_per_lookup_cents").eq("vendor_type", "dnc_scrub").eq("is_enabled", true),
  ]);
  if (metersError || pricingError) throw new Error(metersError?.message ?? pricingError?.message ?? "Could not load meter pricing");

  const pricingByMeter = new Map((rows ?? []).map((row) => [row.meter_key, row]));
  const vendorCosts = (vendors ?? []).map((vendor) => vendor.cost_per_lookup_cents).filter((cost): cost is number => typeof cost === "number");
  return (meters ?? []).map((meter) => {
    // A meter added after SA-4.9 seeded meter_pricing (lead imports, consent claims) may have no row
    // until 20260924360000. It is shown as what it is — unpriced, no platform default — and saving it
    // creates the row (updateMeterPricing upserts).
    const row = pricingByMeter.get(meter.meter_key);
    const fromVendor = meter.meter_key === "dnc_lookups" && vendorCosts.length > 0;
    return {
      meter_key: meter.meter_key as CreditMeterKey,
      cost_cents: fromVendor ? Math.min(...vendorCosts) : row?.cost_cents ?? 0,
      sell_cents: row?.sell_cents ?? 0,
      default_included: row?.default_included ?? null,
      cost_source: fromVendor ? "compliance_vendor" : "configured",
      updated_at: row?.updated_at ?? null,
    } satisfies MeterPricing;
  });
}

function sortByProximity<T extends { used_qty: number; included_qty: number | null; tenant_name: string; meter_key: string }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      proximity(b.used_qty, b.included_qty ?? 0) - proximity(a.used_qty, a.included_qty ?? 0) ||
      a.tenant_name.localeCompare(b.tenant_name) ||
      a.meter_key.localeCompare(b.meter_key),
  );
}

/**
 * The monitor's finite rows, nearest the limit first. `over80` keeps only rows at or past the warn
 * threshold (usage.warn_percent — the name predates the setting).
 *
 * The RPC is the preferred path. It is not trusted when it predates 20260924360000 — that version left
 * add-on credits out of the allowance, so a tenant who had bought an add-on could show as exhausted
 * while enforcement still let them work — or when it is the empty compatibility placeholder. Either
 * way this reads the same source tables and applies check_meter_capacity's rules.
 */
export async function listUsageMonitor(over80 = false, warnFraction?: number): Promise<UsageMonitorRow[]> {
  const supabase = getSupabaseServiceClient();
  const warn = warnFraction ?? (await meterWarnThreshold());
  const { data, error } = await supabase.rpc("admin_usage_monitor_json", { p_over_80: over80 });
  if (error && !["42883", "PGRST202"].includes(error.code ?? "")) throw new Error(error.message);

  const fromRpc = Array.isArray(data) ? (data as unknown as UsageMonitorRow[]) : [];
  const current = fromRpc.length > 0 && fromRpc.every((row) => row && typeof row === "object" && "addon_qty" in row);
  const rows = current ? fromRpc : await usageMonitorFromTables(supabase, warn);

  return sortByProximity(
    rows
      .filter((row) => isWatchable(row.used_qty, row.included_qty))
      .map((row) => ({ ...row, alert_level: alertLevel(row.used_qty, row.included_qty as number, warn) }))
      .filter((row) => !over80 || row.alert_level !== "ok"),
  );
}

function alertLevel(used: number, included: number, warn: number): UsageMonitorRow["alert_level"] {
  const state = limitState(used, included, warn);
  return state === "over" ? "over" : state === "near" ? "warning" : "ok";
}

async function usageMonitorFromTables(supabase: Db, warn: number): Promise<UsageMonitorRow[]> {
  const [tenants, subscriptions, meters, planMeters, pricing, grants, usageTotals, addonLinks, addonMeters] = await Promise.all([
    loadTenants(supabase),
    loadSubscriptions(supabase),
    supabase.from("meters").select("meter_key, label, unit, default_hard_cap, sort_order").order("sort_order"),
    readAll<{ plan_id: string; meter_key: string; included_qty: number | null; hard_cap: boolean }>((from, to) =>
      supabase.from("plan_meters").select("plan_id, meter_key, included_qty, hard_cap").range(from, to),
    ),
    supabase.from("meter_pricing").select("meter_key, default_included"),
    readAll<{ tenant_id: string; meter_key: string; quantity: number; granted_at: string }>((from, to) =>
      supabase.from("credit_grants").select("tenant_id, meter_key, quantity, granted_at").order("id").range(from, to),
    ),
    readAll<{ tenant_id: string; meter_key: string; period_start: string; used_qty: number | null }>((from, to) =>
      supabase.from("usage_totals").select("tenant_id, meter_key, period_start, used_qty").order("tenant_id").range(from, to),
    ),
    readAll<{ subscription_id: string; addon_id: string; detached_at: string | null }>((from, to) =>
      supabase.from("subscription_addons").select("subscription_id, addon_id, detached_at").range(from, to),
    ),
    supabase.from("addon_meters").select("addon_id, meter_key, included_qty"),
  ]);
  const failed = [meters, pricing, addonMeters].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const { plan: planSub, addons: addonSub } = pickSubscriptions(subscriptions);
  const planMeterByKey = new Map(planMeters.map((row) => [`${row.plan_id}:${row.meter_key}`, row]));
  const defaultByMeter = new Map((pricing.data ?? []).map((row) => [row.meter_key, row.default_included]));

  const addonQtyByKey = new Map<string, number>();
  for (const link of addonLinks) {
    if (link.detached_at) continue;
    for (const am of addonMeters.data ?? []) {
      if (am.addon_id !== link.addon_id) continue;
      const key = `${link.subscription_id}:${am.meter_key}`;
      addonQtyByKey.set(key, (addonQtyByKey.get(key) ?? 0) + am.included_qty);
    }
  }

  const periodByTenant = new Map<string, number>();
  for (const [tenantId, sub] of planSub) periodByTenant.set(tenantId, Date.parse(sub.current_period_start ?? monthStartUtc()));

  const grantsByKey = new Map<string, number>();
  for (const grant of grants) {
    const period = periodByTenant.get(grant.tenant_id);
    if (period === undefined || Date.parse(grant.granted_at) < period) continue;
    const key = `${grant.tenant_id}:${grant.meter_key}`;
    grantsByKey.set(key, (grantsByKey.get(key) ?? 0) + grant.quantity);
  }

  const usedByKey = new Map<string, number>();
  for (const usage of usageTotals) {
    // Compared as instants: PostgREST's "…+00:00" and JavaScript's "…Z" are the same moment.
    if (periodByTenant.get(usage.tenant_id) !== Date.parse(usage.period_start)) continue;
    usedByKey.set(`${usage.tenant_id}:${usage.meter_key}`, usage.used_qty ?? 0);
  }

  const rows: UsageMonitorRow[] = [];
  for (const tenant of tenants) {
    const sub = planSub.get(tenant.id);
    if (!sub) continue;
    const liveAddonSub = addonSub.get(tenant.id);
    for (const meter of meters.data ?? []) {
      const planMeter = planMeterByKey.get(`${sub.plan_id}:${meter.meter_key}`);
      const base = planMeter ? planMeter.included_qty : defaultByMeter.get(meter.meter_key) ?? null;
      const addonQty = liveAddonSub ? addonQtyByKey.get(`${liveAddonSub.id}:${meter.meter_key}`) ?? 0 : 0;
      const grantQty = grantsByKey.get(`${tenant.id}:${meter.meter_key}`) ?? 0;
      const included = base === null ? null : base + addonQty + grantQty;
      const used = usedByKey.get(`${tenant.id}:${meter.meter_key}`) ?? 0;
      if (!isWatchable(used, included)) continue;
      rows.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        tenant_status: tenant.status,
        meter_key: meter.meter_key,
        meter_label: meter.label,
        unit: meter.unit,
        used_qty: used,
        included_qty: included,
        grant_qty: grantQty,
        addon_qty: addonQty,
        plan_included_qty: planMeter?.included_qty ?? null,
        hard_cap: planMeter?.hard_cap ?? meter.default_hard_cap ?? true,
        percent_used: included === 0 ? null : Math.round((used / included) * 1000) / 10,
        alert_level: alertLevel(used, included, warn),
        period_start: sub.current_period_start ?? null,
      });
    }
  }
  return rows;
}

/**
 * Seats held against the plan's seat limit — the one seat rule (lib/tenantTeam/seats.ts) and the
 * plan pick of tenant_seat_limit (20260924346000). Tenants whose plan has no seat limit are left out.
 */
export async function listSeatMonitor(): Promise<SeatMonitorRow[]> {
  const supabase = getSupabaseServiceClient();
  const [tenants, subscriptions] = await Promise.all([loadTenants(supabase), loadSubscriptions(supabase)]);
  const { plan: planSub } = pickSubscriptions(subscriptions);
  const planIds = [...new Set([...planSub.values()].map((sub) => sub.plan_id))];
  if (planIds.length === 0) return [];

  const [{ data: plans, error: plansError }, { data: limits, error: limitsError }] = await Promise.all([
    supabase.from("plans").select("id, plan_type").in("id", planIds),
    supabase.from("plan_limits").select("plan_id, max_seats").in("plan_id", planIds),
  ]);
  if (plansError || limitsError) throw new Error(plansError?.message ?? limitsError?.message ?? "Could not load seat limits");
  const planType = new Map((plans ?? []).map((plan) => [plan.id, plan.plan_type as string | null]));
  const maxSeats = new Map((limits ?? []).map((row) => [row.plan_id, row.max_seats]));

  const limited = tenants.flatMap((tenant) => {
    const sub = planSub.get(tenant.id);
    if (!sub) return [];
    const limit = seatLimitFor(maxSeats.get(sub.plan_id), planType.get(sub.plan_id));
    return limit === null ? [] : [{ tenant, limit }];
  });
  if (limited.length === 0) return [];

  const held = new Map<string, number>();
  for (const group of chunks(limited.map((row) => row.tenant.id), 100)) {
    const members = await readAll<{ tenant_id: string; users: { status: string } | null }>((from, to) =>
      supabase
        .from("tenant_users")
        .select("tenant_id, users!tenant_users_user_id_fkey(status)")
        .in("tenant_id", group)
        .order("tenant_id")
        .range(from, to) as unknown as PromiseLike<PageResult<{ tenant_id: string; users: { status: string } | null }>>,
    );
    for (const member of members) {
      if (heldSeat({ status: member.users?.status })) held.set(member.tenant_id, (held.get(member.tenant_id) ?? 0) + 1);
    }
  }

  return limited.map(({ tenant, limit }) => ({
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    tenant_status: tenant.status,
    used_qty: held.get(tenant.id) ?? 0,
    included_qty: limit,
  }));
}

/**
 * The Default limits table: every current plan (the latest non-archived version of each code) against
 * seats, each meter and publishers. A meter the plan does not set shows the platform default
 * (meter_pricing.default_included), which is what check_meter_capacity enforces for it.
 */
export async function listDefaultLimits(): Promise<DefaultLimits> {
  const supabase = getSupabaseServiceClient();
  const { data: planRows, error } = await supabase
    .from("plans")
    .select("id, code, name, version, plan_type, sort_order")
    .eq("is_archived", false)
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);

  const latest = new Map<string, NonNullable<typeof planRows>[number]>();
  for (const plan of planRows ?? []) {
    const current = latest.get(plan.code);
    if (!current || plan.version > current.version) latest.set(plan.code, plan);
  }
  const plans = [...latest.values()];
  const planIds = plans.map((plan) => plan.id);

  const [meters, limits, planMeters, pricing] = await Promise.all([
    supabase.from("meters").select("meter_key, label, sort_order").order("sort_order"),
    planIds.length ? supabase.from("plan_limits").select("plan_id, max_seats, max_publishers").in("plan_id", planIds) : Promise.resolve({ data: [], error: null }),
    planIds.length ? supabase.from("plan_meters").select("plan_id, meter_key, included_qty").in("plan_id", planIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("meter_pricing").select("meter_key, default_included"),
  ]);
  const failed = [meters, limits, planMeters, pricing].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const limitsByPlan = new Map((limits.data ?? []).map((row) => [row.plan_id, row]));
  const planMeterByKey = new Map((planMeters.data ?? []).map((row) => [`${row.plan_id}:${row.meter_key}`, row.included_qty]));
  const defaultByMeter = new Map((pricing.data ?? []).map((row) => [row.meter_key, row.default_included]));

  const row = (key: string, label: string, value: (plan: (typeof plans)[number]) => DefaultLimitRow["values"][string]): DefaultLimitRow => ({
    key,
    label,
    values: Object.fromEntries(plans.map((plan) => [plan.id, value(plan)])),
  });

  const rows: DefaultLimitRow[] = [
    row("seats", "Seats", (plan) => ({ value: seatLimitFor(limitsByPlan.get(plan.id)?.max_seats, plan.plan_type), source: "plan" })),
    ...(meters.data ?? []).map((meter) =>
      row(meter.meter_key, meter.label, (plan) => {
        const key = `${plan.id}:${meter.meter_key}`;
        return planMeterByKey.has(key)
          ? { value: planMeterByKey.get(key) ?? null, source: "plan" as const }
          : { value: defaultByMeter.get(meter.meter_key) ?? null, source: "platform_default" as const };
      }),
    ),
    row("publishers", "Publishers", (plan) => ({ value: limitsByPlan.get(plan.id)?.max_publishers ?? null, source: "plan" })),
  ];

  return {
    plans: plans.map((plan): DefaultLimitPlan => ({ id: plan.id, code: plan.code, name: plan.name, version: plan.version })),
    rows,
  };
}

export async function listCreditTenants(): Promise<CreditTenant[]> {
  const { data, error } = await getSupabaseServiceClient().from("tenants").select("id, name, status").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditTenant[];
}

export async function getCreditsLimitsData(over80 = false): Promise<CreditsLimitsData> {
  const warn = await meterWarnThreshold();
  const [packs, pricing, monitor, seats, defaultLimits, tenants] = await Promise.all([
    listCreditPacks(),
    listMeterPricing(),
    listUsageMonitor(over80, warn),
    listSeatMonitor(),
    listDefaultLimits(),
    listCreditTenants(),
  ]);
  return {
    packs,
    pricing,
    monitor,
    seats: over80 ? seats.filter((row) => limitState(row.used_qty, row.included_qty, warn) !== "ok") : seats,
    defaultLimits,
    tenants,
    warnPercent: Math.round(warn * 100),
  };
}

export async function createCreditPack(input: CreditPackInput): Promise<CreditPack> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .insert(input)
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as CreditPack;
}

export async function updateCreditPack(id: string, input: Partial<CreditPackInput>): Promise<CreditPack> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as CreditPack;
}

export class GrantRequestConflictError extends Error {}

/**
 * Records a grant exactly once per request.
 *
 * `id` is the client's request id, used as the row's primary key. A retry of the same request — after
 * a timeout, a lost response, or a failure after the insert committed — hits the primary key and gets
 * the committed row back with `replayed: true` instead of a second grant. The same id with different
 * details is refused rather than silently answered with the first one.
 */
export async function grantCredits(input: {
  id?: string;
  tenant_id: string;
  meter_key: CreditMeterKey;
  quantity: number;
  reason: string;
  granted_by: string;
}): Promise<{ id: string; replayed: boolean }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("credit_grants").insert(input).select("id").single();
  if (!error) return { id: (data as { id: string }).id, replayed: false };
  if (error.code !== "23505" || !input.id) throw new Error(error.message);

  const { data: existing, error: readError } = await supabase
    .from("credit_grants")
    .select("id, tenant_id, meter_key, quantity")
    .eq("id", input.id)
    .maybeSingle();
  if (readError || !existing) throw new Error(readError?.message ?? error.message);
  if (existing.tenant_id !== input.tenant_id || existing.meter_key !== input.meter_key || existing.quantity !== input.quantity) {
    throw new GrantRequestConflictError("This grant request was already used for a different grant. Close the dialog and start again.");
  }
  return { id: existing.id, replayed: true };
}

/** Whether an action on a target is already in the audit log — so a replayed grant is audited once. */
export async function hasAuditEntry(action: string, targetId: string): Promise<boolean> {
  const { count, error } = await getSupabaseServiceClient()
    .from("audit_log")
    .select("*", { count: "exact", head: true })
    .eq("action", action)
    .eq("target_id", targetId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export async function updateMeterPricing(input: { meter_key: CreditMeterKey; cost_cents?: number; sell_cents: number; default_included: number | null; updated_by: string }): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const patch: { meter_key: CreditMeterKey; cost_cents?: number; sell_cents: number; default_included: number | null; updated_at: string; updated_by: string } = {
    meter_key: input.meter_key,
    sell_cents: input.sell_cents,
    default_included: input.default_included,
    updated_at: new Date().toISOString(),
    updated_by: input.updated_by,
  };
  if (input.cost_cents !== undefined) patch.cost_cents = input.cost_cents;
  // Upsert, not update: a meter with no pricing row yet (see listMeterPricing) would otherwise "save"
  // by changing nothing and reporting success.
  const { error } = await supabase.from("meter_pricing").upsert(patch, { onConflict: "meter_key" });
  if (error) throw new Error(error.message);
}

/**
 * Sells a credit pack: raises the invoice AND grants the credits, atomically.
 *
 * One RPC rather than two calls from here, because the invoice and the grant have to be the same
 * transaction. This previously raised the invoice and returned — it never wrote a credit_grants
 * row, and nothing else did, so the customer was billed and their balance did not move
 * (bugs_sa.md #11). Doing it as two sequential writes would leave the same bug in a narrower
 * window; the database is the only place the two can be made inseparable.
 *
 * The entitlement rebuild is the ROUTE's job, after the audit entry and best-effort: a failed rebuild
 * reported as a failed purchase invited a retry, and a retry is a second invoice and a second grant.
 */
export async function purchaseCreditPack(input: {
  packId: string;
  tenantId: string;
  subscriptionId: string | null;
  quantity: number;
  reason: string;
  createdBy: string;
}) {
  const { data, error } = await getSupabaseServiceClient().rpc("purchase_credit_pack", {
    p_pack_id: input.packId,
    p_tenant_id: input.tenantId,
    p_subscription_id: input.subscriptionId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_created_by: input.createdBy,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The purchase did not complete");

  return {
    invoiceId: row.invoice_id,
    number: row.number,
    totalCents: row.total_cents,
    grantId: row.grant_id,
    packName: row.pack_name,
    meterKey: row.meter_key,
    packQuantity: row.granted_qty,
  };
}
