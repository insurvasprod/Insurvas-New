import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { MeterRow, PlanLimits, PlanMeterRow, TenantUsageRow } from "./constants";

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
    .select("max_seats, max_carriers, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users")
    .eq("plan_id", planId)
    .maybeSingle<PlanLimits>();
  return data ?? null;
}

export type TenantUsageSummary = {
  periodStart: string | null;
  planId: string | null;
  planName: string | null;
  planVersion: number | null;
  seatsUsed: number;
  maxSeats: number | null;
  meters: TenantUsageRow[];
};

/**
 * Usage for the tenant's CURRENT billing period, joined to whatever their plan allows.
 * Meters the plan doesn't mention are omitted; meters allowed but unused show zero, because
 * "0 of 2,000 used" is more useful than a missing row.
 */
export async function fetchTenantUsage(tenantId: string): Promise<TenantUsageSummary> {
  const supabase = getSupabaseServiceClient();

  const [{ data: periodStart }, { data: planId }, { data: seatsUsed }, meters] = await Promise.all([
    supabase.rpc("tenant_current_period_start", { p_tenant_id: tenantId }),
    supabase.rpc("tenant_current_plan", { p_tenant_id: tenantId }),
    supabase.rpc("tenant_seats_used", { p_tenant_id: tenantId }),
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
      seatsUsed: (seatsUsed as unknown as number) ?? 0,
      maxSeats: null,
      meters: [],
    };
  }

  const [{ data: plan }, planMeters, limits, { data: totals }] = await Promise.all([
    supabase.from("plans").select("name, version").eq("id", resolvedPlanId).maybeSingle<{
      name: string;
      version: number;
    }>(),
    fetchPlanMeters(resolvedPlanId),
    fetchPlanLimits(resolvedPlanId),
    supabase
      .from("usage_totals")
      .select("meter_key, used_qty")
      .eq("tenant_id", tenantId)
      .eq("period_start", resolvedPeriod ?? ""),
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
    seatsUsed: (seatsUsed as unknown as number) ?? 0,
    maxSeats: limits?.max_seats ?? null,
    meters: rows,
  };
}
