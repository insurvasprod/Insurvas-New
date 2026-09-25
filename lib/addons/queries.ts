import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { BillingCycle } from "@/lib/money";
import type { AddonRow, AttachedAddon } from "./constants";
import {
  computeCatalogStats,
  REVENUE_STATUSES,
  type AddonCatalogStats,
  type LiveAttachment,
  type PlanPriceRow,
  type PlanRef,
  type RevenueSubscription,
} from "./catalogView";

export type { AddonRow, AttachedAddon };

/** Every add-on with its granted features and meter credits. */
export async function fetchAddons(options?: { activeOnly?: boolean }): Promise<AddonRow[]> {
  const supabase = getSupabaseServiceClient();

  let request = supabase
    .from("addons")
    .select("id, code, name, description, price_cents, billing_cycle, is_active, sort_order")
    .order("sort_order")
    // Ties broken by name so the list — and the footer's "by sort order, then name" — is stable.
    .order("name");

  if (options?.activeOnly) request = request.eq("is_active", true);

  const { data: addons, error: addonError } = await request;
  if (addonError) throw new Error(`Could not load add-ons: ${addonError.message}`);
  if (!addons?.length) return [];

  const ids = addons.map((a) => a.id);
  const [{ data: features, error: featureError }, { data: meters, error: meterError }, { data: planAvailability, error: planError }] = await Promise.all([
    supabase.from("addon_features").select("addon_id, feature_key").in("addon_id", ids),
    supabase.from("addon_meters").select("addon_id, meter_key, included_qty").in("addon_id", ids),
    supabase.from("plan_available_addons").select("addon_id, plan_id").in("addon_id", ids),
  ]);
  if (featureError || meterError || planError) throw new Error("Could not load add-on configuration");

  const featuresByAddon = new Map<string, string[]>();
  for (const row of features ?? []) {
    featuresByAddon.set(row.addon_id, [...(featuresByAddon.get(row.addon_id) ?? []), row.feature_key]);
  }

  const metersByAddon = new Map<string, { meter_key: string; included_qty: number }[]>();
  for (const row of meters ?? []) {
    metersByAddon.set(row.addon_id, [
      ...(metersByAddon.get(row.addon_id) ?? []),
      { meter_key: row.meter_key, included_qty: row.included_qty },
    ]);
  }

  const plansByAddon = new Map<string, string[]>();
  for (const row of planAvailability ?? []) {
    plansByAddon.set(row.addon_id, [...(plansByAddon.get(row.addon_id) ?? []), row.plan_id]);
  }

  return addons.map((a) => ({
    ...a,
    feature_keys: featuresByAddon.get(a.id) ?? [],
    meters: metersByAddon.get(a.id) ?? [],
    plan_ids: plansByAddon.get(a.id) ?? [],
  })) as AddonRow[];
}

/** Live attachments on a subscription — detached ones stay in the table but are excluded here. */
export async function fetchAttachedAddons(subscriptionId: string): Promise<AttachedAddon[]> {
  const supabase = getSupabaseServiceClient();

  const { data } = await supabase
    .from("subscription_addons")
    .select("id, addon_id, attached_at, availability_overridden, addons(code, name, price_cents, billing_cycle)")
    .eq("subscription_id", subscriptionId)
    .is("detached_at", null)
    .returns<
      {
        id: string;
        addon_id: string;
        attached_at: string;
        availability_overridden: boolean;
        addons: { code: string; name: string; price_cents: number; billing_cycle: string } | null;
      }[]
    >();

  return (data ?? [])
    .filter((row) => row.addons)
    .map((row) => ({
      id: row.id,
      addon_id: row.addon_id,
      code: row.addons!.code,
      name: row.addons!.name,
      price_cents: row.addons!.price_cents,
      billing_cycle: row.addons!.billing_cycle,
      attached_at: row.attached_at,
      availability_overridden: row.availability_overridden,
    })) as AttachedAddon[];
}

const PAGE = 1000;

/** PostgREST caps a response at 1,000 rows; read every page so a count is never a silent 1,000. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Every plan version, archived included: availability rows point at versions, not codes. */
export async function fetchPlanRefs(): Promise<PlanRef[]> {
  const supabase = getSupabaseServiceClient();
  return readAll<PlanRef>((from, to) =>
    supabase.from("plans").select("id, code, name, version, is_archived").order("sort_order").order("code").order("version").range(from, to),
  );
}

/**
 * Attachment and revenue figures for the catalog.
 *
 * Returns null when any read fails: the tiles then say so, instead of a confident zero.
 */
export async function fetchAddonCatalogStats(addons: AddonRow[]): Promise<AddonCatalogStats | null> {
  const supabase = getSupabaseServiceClient();
  try {
    const [attachments, subscriptions, planPrices] = await Promise.all([
      // Filtered in the database through the inner join, not by sending ids back as an .in() list.
      readAll<{ addon_id: string; subscriptions: { tenant_id: string; status: string; billing_cycle: BillingCycle } | null }>((from, to) =>
        supabase
          .from("subscription_addons")
          .select("addon_id, subscriptions!inner(tenant_id, status, billing_cycle)")
          .is("detached_at", null)
          .neq("subscriptions.status", "cancelled")
          .order("id")
          .range(from, to)
          .returns<{ addon_id: string; subscriptions: { tenant_id: string; status: string; billing_cycle: BillingCycle } | null }[]>(),
      ),
      readAll<RevenueSubscription>((from, to) =>
        supabase
          .from("subscriptions")
          .select("plan_id, billing_cycle")
          .in("status", [...REVENUE_STATUSES])
          .order("id")
          .range(from, to)
          .returns<RevenueSubscription[]>(),
      ),
      readAll<PlanPriceRow>((from, to) =>
        supabase
          .from("plan_prices")
          .select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents")
          .order("plan_id")
          .range(from, to)
          .returns<PlanPriceRow[]>(),
      ),
    ]);

    const live: LiveAttachment[] = [];
    for (const row of attachments) {
      if (!row.subscriptions) continue;
      live.push({ addon_id: row.addon_id, ...row.subscriptions });
    }
    return computeCatalogStats({ attachments: live, subscriptions, planPrices, addons });
  } catch {
    return null;
  }
}

/**
 * Live attachments the billing run still invoices (not detached, subscription not cancelled). While
 * this is above zero the add-on's price and billing cycle are locked. Throws on a failed read — the
 * caller must refuse the edit rather than guess.
 */
export async function countBilledAttachments(addonId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("subscription_addons")
    .select("id, subscriptions!inner(status)", { count: "exact", head: true })
    .eq("addon_id", addonId)
    .is("detached_at", null)
    .neq("subscriptions.status", "cancelled");
  if (error) throw new Error(`Could not count live attachments: ${error.message}`);
  return count ?? 0;
}

/** Plan version ids that currently offer an add-on. Throws on a failed read. */
export async function fetchAddonPlanIds(addonId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("plan_available_addons").select("plan_id").eq("addon_id", addonId);
  if (error) throw new Error(`Could not read add-on availability: ${error.message}`);
  return (data ?? []).map((row) => row.plan_id as string);
}

/** Add-on ids a given plan version offers. */
export async function fetchAvailableAddonIds(planId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("plan_available_addons").select("addon_id").eq("plan_id", planId);
  return (data ?? []).map((r) => r.addon_id);
}
