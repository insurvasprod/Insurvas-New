import "server-only";

import { fetchPlans } from "@/lib/plans/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { BillingCycle } from "@/lib/money";

/**
 * The public add-on projection for the pricing page: active add-ons that at least one PUBLIC plan
 * offers, with marketing-safe fields only (no ids, no attachment counts, no plan internals).
 *
 * The pricing page used to print three add-ons as literals — "Dial minutes 5,000 · $75 once" among
 * them — under a line promising "every price on this page is read from the catalog". Filtering by
 * public-plan availability matters as much as reading them: the catalog also holds add-ons that
 * verification scripts create against their own private plans, and "active" alone would publish
 * every one of those on the marketing site.
 */
export type PublicAddon = {
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  billing_cycle: BillingCycle;
};

export async function fetchPublicAddons(): Promise<PublicAddon[]> {
  const publicPlanIds = (await fetchPlans({ includeArchived: false })).filter((plan) => plan.is_public).map((plan) => plan.id);
  if (!publicPlanIds.length) return [];

  const supabase = getSupabaseServiceClient();
  const offered = await supabase.from("plan_available_addons").select("addon_id").in("plan_id", publicPlanIds);
  if (offered.error) throw new Error(`Could not load public add-on availability: ${offered.error.message}`);
  const addonIds = [...new Set((offered.data ?? []).map((row) => row.addon_id as string))];
  if (!addonIds.length) return [];

  const { data, error } = await supabase
    .from("addons")
    .select("code, name, description, price_cents, billing_cycle")
    .in("id", addonIds)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Could not load public add-ons: ${error.message}`);
  return (data ?? []) as PublicAddon[];
}
