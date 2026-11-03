import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchFeatureCatalog } from "@/lib/features/queries";
import type { FeatureModuleGroup } from "@/lib/features/constants";
import type { PlanPrices } from "@/lib/money";
import type { PlanLimits, PlanMeterRow } from "@/lib/metering/constants";
import { nextPlanVersion, type PlanEditorMeter } from "@/lib/plans/planSave";

export type { PlanEditorMeter };

export type PlanVersionEditorData = {
  plan: {
    id: string;
    code: string;
    version: number;
    name: string;
    is_archived: boolean;
  };
  /** Every module and feature, archived included — the UI decides how to present them. */
  groups: FeatureModuleGroup[];
  grantedKeys: string[];
  /** Null when pricing has never been set, i.e. the plan isn't sellable yet. */
  prices: PlanPrices | null;
  limits: PlanLimits | null;
  /** Non-cancelled subscriptions on THIS version. Non-zero means saving publishes a new version. */
  subscriberCount: number;
  /** The version a publish would create: max(version) of the code + 1, as admin_create_plan_version numbers it. */
  nextVersion: number;
  meters: PlanEditorMeter[];
};

export async function fetchPlanVersionEditorData(planId: string): Promise<PlanVersionEditorData | null> {
  const supabase = getSupabaseServiceClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, code, version, name, is_archived")
    .eq("id", planId)
    .maybeSingle<PlanVersionEditorData["plan"]>();

  if (!plan) return null;

  const [groups, { data: granted }, { data: prices }, { data: limits }, { count }, { data: versions }, { data: meterRows }, { data: pricing }, { data: planMeters }] = await Promise.all([
    fetchFeatureCatalog({ includeArchived: true }),
    supabase.from("plan_features").select("feature_key").eq("plan_id", planId),
    supabase
      .from("plan_prices")
      .select(
        "price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency",
      )
      .eq("plan_id", planId)
      .maybeSingle<PlanPrices>(),
    supabase.from("plan_limits").select("max_seats, max_carriers, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users, max_setter_seats, max_active_campaigns").eq("plan_id", planId).maybeSingle<PlanLimits>(),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId)
      .neq("status", "cancelled"),
    supabase.from("plans").select("version").eq("code", plan.code),
    supabase.from("meters").select("meter_key, label, unit, default_hard_cap, sort_order").order("sort_order"),
    supabase.from("meter_pricing").select("meter_key, default_included"),
    supabase.from("plan_meters").select("meter_key, included_qty, hard_cap").eq("plan_id", planId),
  ]);

  const defaults = new Map((pricing ?? []).map((row) => [row.meter_key, row.default_included]));
  const own = new Map((planMeters ?? []).map((row) => [row.meter_key, row as PlanMeterRow]));
  const meters: PlanEditorMeter[] = (meterRows ?? []).map((row) => {
    const mine = own.get(row.meter_key);
    return {
      meter_key: row.meter_key,
      label: row.label,
      unit: row.unit,
      default_hard_cap: row.default_hard_cap,
      platform_default: defaults.get(row.meter_key) ?? null,
      plan: mine ? { included_qty: mine.included_qty, hard_cap: mine.hard_cap } : null,
    };
  });

  return {
    plan,
    groups,
    grantedKeys: (granted ?? []).map((row) => row.feature_key),
    prices: prices ?? null,
    limits: limits ?? null,
    subscriberCount: count ?? 0,
    nextVersion: nextPlanVersion((versions ?? []).map((row) => row.version), plan.version),
    meters,
  };
}

/** Feature keys granted by a specific plan version — what SA-2.8 will build entitlements from. */
export async function fetchPlanFeatureKeys(planId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("plan_features").select("feature_key").eq("plan_id", planId);
  return (data ?? []).map((row) => row.feature_key);
}

/** Prices keyed by plan id, for list screens that show many plans at once. */
export async function fetchPricesForPlans(planIds: string[]): Promise<Map<string, PlanPrices>> {
  if (planIds.length === 0) return new Map();

  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("plan_prices")
    .select(
      "plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days, currency",
    )
    .in("plan_id", planIds);

  return new Map((data ?? []).map((row) => [row.plan_id, row as unknown as PlanPrices]));
}
