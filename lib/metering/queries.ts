import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { MeterRow, PlanLimits, PlanMeterRow, TenantUsageRow } from "./constants";
import { fetchTenantSeatCounts } from "@/lib/adminTenantUsers/queries";
import { seatLimitFor } from "@/lib/tenantTeam/seats";

export type { MeterRow, PlanLimits, PlanMeterRow, TenantUsageRow };

export async function fetchMeters(): Promise<MeterRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("meters")
    .select("meter_key, unit, label, default_hard_cap, sort_order")
    .order("sort_order");
  return (data ?? []) as MeterRow[];
}

export async function fetchPlanMeters(planId: string): Promise<PlanMeterRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("plan_meters")
    .select("meter_key, included_qty, hard_cap")
    .eq("plan_id", planId);
  return (data ?? []) as PlanMeterRow[];
}

export async function fetchPlanLimits(planId: string): Promise<PlanLimits | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("plan_limits")
    .select("max_seats, max_carriers, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users, max_setter_seats, max_active_campaigns")
    .eq("plan_id", planId)
    .maybeSingle<PlanLimits>();
  return data ?? null;
}

export type TenantUsageSummary = {
  periodStart: string | null;
  planId: string | null;
  planName: string | null;
  planVersion: number | null;
  /** Seats held by the one seat rule (fetchTenantSeatCounts). Null = could not be counted; see `seatsError`. */
  seatsUsed: number | null;
  seatsError: string | null;
  maxSeats: number | null;
  /**
   * Publisher partners counted the way the create path enforces the cap (draft + active,
   * 20260912150000) against plan_limits.max_publishers (null = no limit). Null with no plan.
   */
  publishers: { used: number | null; max: number | null; error: string | null } | null;
  meters: TenantUsageRow[];
};

type Counted = { value: number | null; error: string | null };

function failure(error: unknown): Counted {
  return { value: null, error: error instanceof Error ? error.message : String(error) };
}

/** The one seat rule, through the same memoised read as the record's frame chip. */
function countSeats(tenantId: string): Promise<Counted> {
  return fetchTenantSeatCounts(tenantId).then((counts) => ({ value: counts.held, error: null }), failure);
}

/** Publishers that hold a slot against max_publishers: the create path's own count (draft + active). */
async function countPublishers(tenantId: string): Promise<Counted> {
  const { count, error } = await getSupabaseServiceClient()
    .from("partners")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("partner_type", "publisher")
    .in("status", ["draft", "active"]);
  if (error) return { value: null, error: `Could not count publishers: ${error.message}` };
  return { value: count ?? 0, error: null };
}

/**
 * Usage for the tenant's CURRENT billing period, joined to whatever their plan allows.
 * Meters the plan doesn't mention are omitted; meters allowed but unused show zero, because
 * "0 of 2,000 used" is more useful than a missing row.
 */
export async function fetchTenantUsage(tenantId: string): Promise<TenantUsageSummary> {
  const supabase = getSupabaseServiceClient();

  const [{ data: periodStart }, { data: planId }, seats, meters] = await Promise.all([
    supabase.rpc("tenant_current_period_start", { p_tenant_id: tenantId }),
    supabase.rpc("tenant_current_plan", { p_tenant_id: tenantId }),
    countSeats(tenantId),
    fetchMeters(),
  ]);

  const resolvedPlanId = (planId as unknown as string) ?? null;
  const resolvedPeriod = (periodStart as unknown as string) ?? null;

  if (!resolvedPlanId) {
    return {
      periodStart: resolvedPeriod,
      planId: null,
      planName: null,
      planVersion: null,
      seatsUsed: seats.value,
      seatsError: seats.error,
      maxSeats: null,
      publishers: null,
      meters: [],
    };
  }

  const [{ data: plan }, planMeters, limits, { data: totals }, publishers] = await Promise.all([
    supabase.from("plans").select("name, version, plan_type").eq("id", resolvedPlanId).maybeSingle<{
      name: string;
      version: number;
      plan_type: string | null;
    }>(),
    fetchPlanMeters(resolvedPlanId),
    fetchPlanLimits(resolvedPlanId),
    supabase
      .from("usage_totals")
      .select("meter_key, used_qty")
      .eq("tenant_id", tenantId)
      .eq("period_start", resolvedPeriod ?? ""),
    countPublishers(tenantId).catch(failure),
  ]);

  const usedByMeter = new Map((totals ?? []).map((t) => [t.meter_key, t.used_qty]));
  const meterByKey = new Map(meters.map((m) => [m.meter_key, m]));

  const rows: TenantUsageRow[] = planMeters
    .map((pm) => {
      const meter = meterByKey.get(pm.meter_key);
      if (!meter) return null;
      return {
        meter_key: pm.meter_key,
        label: meter.label,
        unit: meter.unit,
        used_qty: usedByMeter.get(pm.meter_key) ?? 0,
        included_qty: pm.included_qty,
        hard_cap: pm.hard_cap,
      };
    })
    .filter((r): r is TenantUsageRow => r !== null)
    .sort((a, b) => (meterByKey.get(a.meter_key)?.sort_order ?? 0) - (meterByKey.get(b.meter_key)?.sort_order ?? 0));

  return {
    periodStart: resolvedPeriod,
    planId: resolvedPlanId,
    planName: plan?.name ?? null,
    planVersion: plan?.version ?? null,
    seatsUsed: seats.value,
    seatsError: seats.error,
    // An individual plan with no explicit max_seats is one seat (the entitlement engine's fallback), not unlimited.
    maxSeats: seatLimitFor(limits?.max_seats, plan?.plan_type),
    publishers: { used: publishers.value, max: limits?.max_publishers ?? null, error: publishers.error },
    meters: rows,
  };
}
