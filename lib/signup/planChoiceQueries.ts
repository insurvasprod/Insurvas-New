import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingCycle } from "@/lib/money";
import { fetchPlans } from "@/lib/plans/queries";
import { resolveTrialDays } from "@/lib/checkout/constants";
import { defaultTrialDays } from "@/lib/settings/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { withSeatBands, type PlanChoiceAddon, type PlanChoiceModule, type PlanChoiceOption } from "./planChoice";

// Untyped, for what 20261026300000 adds (signup_selections.seats, signup_selection_addons) and the
// generated types do not have yet.
const untyped = () => getSupabaseServiceClient() as unknown as SupabaseClient;

/** Undefined column or table: 20261026300000 is not applied yet, so the seat count and add-ons are not kept. */
const notApplied = (error: { code?: string } | null) => error?.code === "42703" || error?.code === "42P01" || error?.code === "PGRST204" || error?.code === "PGRST205";

/**
 * The public plans as the plan step needs them: prices in cents per cycle, the seat band, which
 * features each grants, and the active add-ons each offers. Same filter as the pricing page
 * (public, not archived), so nothing private is ever offered here.
 */
export async function fetchPlanChoices(): Promise<{ plans: PlanChoiceOption[]; modules: PlanChoiceModule[] }> {
  const latest = (await fetchPlans({ includeArchived: false })).filter((plan) => plan.is_public);
  if (latest.length === 0) return { plans: [], modules: [] };

  const supabase = getSupabaseServiceClient();
  const ids = latest.map((plan) => plan.id);
  const [prices, limits, grants, offered, features, modules] = await Promise.all([
    supabase.from("plan_prices").select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents, trial_days").in("plan_id", ids),
    supabase.from("plan_limits").select("plan_id, max_seats").in("plan_id", ids),
    supabase.from("plan_features").select("plan_id, feature_key").in("plan_id", ids),
    supabase.from("plan_available_addons").select("plan_id, addons(code, name, description, price_cents, billing_cycle, is_active, sort_order)").in("plan_id", ids),
    supabase.from("features").select("feature_key, label, module, sort_order").eq("is_archived", false).order("sort_order"),
    supabase.from("feature_modules").select("key, label, sort_order").order("sort_order"),
  ]);
  if (prices.error) throw new Error(`Could not load plan prices: ${prices.error.message}`);
  if (grants.error) throw new Error(`Could not load plan features: ${grants.error.message}`);

  const priceBy = new Map((prices.data ?? []).map((row) => [row.plan_id, row]));
  const seatsBy = new Map((limits.data ?? []).map((row) => [row.plan_id, row.max_seats as number | null]));
  const grantsBy = new Map<string, string[]>();
  for (const row of grants.data ?? []) grantsBy.set(row.plan_id, [...(grantsBy.get(row.plan_id) ?? []), row.feature_key]);
  type AddonJoin = { code: string; name: string; description: string | null; price_cents: number; billing_cycle: BillingCycle; is_active: boolean; sort_order: number };
  const addonsBy = new Map<string, { addon: PlanChoiceAddon; order: number }[]>();
  // An unreadable add-on list offers none rather than failing the step.
  for (const row of (offered.error ? [] : offered.data ?? []) as unknown as { plan_id: string; addons: AddonJoin | null }[]) {
    if (!row.addons?.is_active) continue;
    const addon = { code: row.addons.code, name: row.addons.name, description: row.addons.description, priceCents: row.addons.price_cents, cycle: row.addons.billing_cycle };
    addonsBy.set(row.plan_id, [...(addonsBy.get(row.plan_id) ?? []), { addon, order: row.addons.sort_order }]);
  }

  // The same rule as trialDaysForPlan (lib/checkout/trialDays.ts): a plan without its own trial gets
  // the platform default, which is what checkout grants it, not "no trial".
  const defaultTrial = await defaultTrialDays().catch(() => null);
  const plans = withSeatBands(latest.map((plan) => {
    const price = priceBy.get(plan.id);
    return {
      code: plan.code,
      name: plan.name,
      blurb: plan.description,
      audience: plan.plan_type === "individual" ? "individual" as const : "agency" as const,
      cents: { monthly: price?.price_monthly_cents ?? null, quarterly: price?.price_quarterly_cents ?? null, yearly: price?.price_yearly_cents ?? null },
      trialDays: resolveTrialDays(price?.trial_days ?? null, defaultTrial),
      maxSeats: seatsBy.get(plan.id) ?? null,
      featureKeys: grantsBy.get(plan.id) ?? [],
      addons: (addonsBy.get(plan.id) ?? []).sort((a, b) => a.order - b.order || a.addon.name.localeCompare(b.addon.name)).map((entry) => entry.addon),
    };
  }));

  // Only features some public plan grants: a feature no plan sells would read as "missing" everywhere.
  const sold = new Set(plans.flatMap((plan) => plan.featureKeys));
  const moduleRows = modules.error ? [] : modules.data ?? [];
  const grouped = new Map<string, { module: PlanChoiceModule; order: number }>();
  for (const feature of features.data ?? []) {
    if (!sold.has(feature.feature_key)) continue;
    const key = feature.module ?? "other";
    const meta = moduleRows.find((row) => row.key === key);
    const group = grouped.get(key) ?? { module: { key, label: meta?.label ?? key, features: [] }, order: meta?.sort_order ?? 999 };
    group.module.features.push({ key: feature.feature_key, label: feature.label });
    grouped.set(key, group);
  }
  return { plans, modules: [...grouped.values()].sort((a, b) => a.order - b.order).map((group) => group.module) };
}

/**
 * `chosen`: the person picked this plan themselves, on the pricing page or the plan step
 * (signup_selections.plan_chosen_at, 20261028210000). False for the default plan, and before that
 * migration is applied, so the chooser is shown whenever we cannot tell.
 */
export type SavedPlanChoice = { planCode: string; billingCycle: BillingCycle; seats: number | null; addonCodes: string[]; chosen: boolean };

/** Records that the person picked the plan on the signup_selections row. A missing column is not an error. */
export async function markPlanChosen(tenantId: string): Promise<void> {
  const { error } = await untyped().from("signup_selections").update({ plan_chosen_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  if (error && !notApplied(error)) console.error("[plan choice] plan_chosen_at not saved", tenantId, error.message);
}

/** What this tenant chose, for the plan step and Payment. Null before any choice. */
export async function readPlanChoice(tenantId: string): Promise<SavedPlanChoice | null> {
  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase.from("signup_selections").select("plan_id, billing_cycle").eq("tenant_id", tenantId).maybeSingle();
  if (!selection) return null;
  const [{ data: plan }, seats, addons, chosen] = await Promise.all([
    supabase.from("plans").select("code").eq("id", selection.plan_id).maybeSingle(),
    untyped().from("signup_selections").select("seats").eq("tenant_id", tenantId).maybeSingle(),
    untyped().from("signup_selection_addons").select("addons(code)").eq("tenant_id", tenantId),
    untyped().from("signup_selections").select("plan_chosen_at").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!plan) return null;
  return {
    planCode: plan.code,
    billingCycle: selection.billing_cycle,
    seats: seats.error ? null : ((seats.data as { seats: number | null } | null)?.seats ?? null),
    addonCodes: addons.error ? [] : ((addons.data ?? []) as unknown as { addons: { code: string } | null }[]).flatMap((row) => (row.addons ? [row.addons.code] : [])),
    chosen: !chosen.error && Boolean((chosen.data as { plan_chosen_at: string | null } | null)?.plan_chosen_at),
  };
}

/**
 * Saves the choice: plan and cycle always; the seat count and add-ons once 20261026300000 is
 * applied. Refuses add-ons it cannot keep rather than dropping them silently.
 */
export async function savePlanChoice(tenantId: string, choice: { planCode: string; billingCycle: BillingCycle; seats: number; addonCodes: string[] }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = getSupabaseServiceClient();
  const plan = (await fetchPlans({ includeArchived: false })).find((row) => row.code === choice.planCode && row.is_public);
  if (!plan) return { ok: false, error: "That plan is no longer available.", status: 409 };

  const { error } = await supabase
    .from("signup_selections")
    .upsert({ tenant_id: tenantId, plan_id: plan.id, billing_cycle: choice.billingCycle, selected_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: "Could not save your plan. Try again.", status: 500 };
  // Picked on the plan step: from now on the step shows it instead of asking again.
  await markPlanChosen(tenantId);

  const seats = await untyped().from("signup_selections").update({ seats: choice.seats }).eq("tenant_id", tenantId);
  if (seats.error && !notApplied(seats.error)) console.error("[plan step] seats not saved", tenantId, seats.error.message);

  const cleared = await untyped().from("signup_selection_addons").delete().eq("tenant_id", tenantId);
  if (cleared.error) {
    if (!notApplied(cleared.error)) return { ok: false, error: "Could not save your add-ons. Try again.", status: 500 };
    if (choice.addonCodes.length) return { ok: false, error: "Add-ons can't be chosen at sign-up yet. Untick them to continue; you can add them in Settings › Plan & billing.", status: 503 };
    return { ok: true };
  }
  if (choice.addonCodes.length) {
    const { data: rows } = await supabase.from("addons").select("id, code").in("code", choice.addonCodes);
    const insert = (rows ?? []).map((row) => ({ tenant_id: tenantId, addon_id: row.id }));
    const added = await untyped().from("signup_selection_addons").insert(insert);
    if (added.error) return { ok: false, error: "Could not save your add-ons. Try again.", status: 500 };
  }
  return { ok: true };
}

/** Addons ticked at sign-up, by id, for checkout completion to attach. Empty before 20261026300000. */
export async function readSignupAddonIds(tenantId: string): Promise<string[]> {
  const { data, error } = await untyped().from("signup_selection_addons").select("addon_id").eq("tenant_id", tenantId);
  if (error) return [];
  return ((data ?? []) as { addon_id: string }[]).map((row) => row.addon_id);
}
