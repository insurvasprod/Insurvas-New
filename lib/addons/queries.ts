import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { AddonRow, AttachedAddon } from "./constants";

export type { AddonRow, AttachedAddon };

/** Every add-on with its granted features and meter credits. */
export async function fetchAddons(options?: { activeOnly?: boolean }): Promise<AddonRow[]> {
  const supabase = getSupabaseServiceClient();

  let request = supabase
    .from("addons")
    .select("id, code, name, description, price_cents, billing_cycle, is_active, sort_order")
    .order("sort_order");

  if (options?.activeOnly) request = request.eq("is_active", true);

  const { data: addons } = await request;
  if (!addons?.length) return [];

  const ids = addons.map((a) => a.id);
  const [{ data: features }, { data: meters }] = await Promise.all([
    supabase.from("addon_features").select("addon_id, feature_key").in("addon_id", ids),
    supabase.from("addon_meters").select("addon_id, meter_key, included_qty").in("addon_id", ids),
  ]);

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

  return addons.map((a) => ({
    ...a,
    feature_keys: featuresByAddon.get(a.id) ?? [],
    meters: metersByAddon.get(a.id) ?? [],
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

/** Add-on ids a given plan version offers. */
export async function fetchAvailableAddonIds(planId: string): Promise<string[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("plan_available_addons").select("addon_id").eq("plan_id", planId);
  return (data ?? []).map((r) => r.addon_id);
}
