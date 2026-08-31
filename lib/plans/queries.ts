import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PlanListRow, PlanVersionRow } from "./constants";

export type { PlanListRow, PlanVersionRow };

const LIST_COLUMNS =
  "id, code, version, name, plan_type, description, is_public, is_archived, is_default, sort_order, created_at, version_count, subscriber_count, ever_subscribed_count";

/**
 * One row per plan code (its latest version).
 *
 * `includeArchived` is the difference between the admin screen (shows everything so archived
 * plans can be found and restored) and the assign-plan picker (must not offer them).
 */
export async function fetchPlans(
  options: { includeArchived: boolean } = { includeArchived: true },
): Promise<PlanListRow[]> {
  const supabase = getSupabaseServiceClient();

  let request = supabase.from("admin_plan_list").select(LIST_COLUMNS).order("sort_order");
  if (!options.includeArchived) request = request.eq("is_archived", false);

  const { data, error } = await request;
  if (error) throw new Error(`Could not load plans: ${error.message}`);

  return (data ?? []) as PlanListRow[];
}

/**
 * What SA-2.7's "assign plan" picker uses. Archived plans are excluded here but keep working
 * for anyone already subscribed — that's the whole point of archiving rather than deleting.
 */
export function fetchPlansForPicker(): Promise<PlanListRow[]> {
  return fetchPlans({ includeArchived: false });
}

/** Every version of one code, newest first, with per-version subscriber counts. */
export async function fetchPlanVersions(code: string): Promise<PlanVersionRow[]> {
  const supabase = getSupabaseServiceClient();

  const { data: versions } = await supabase
    .from("plans")
    .select("id, code, version, name, plan_type, is_archived, created_at")
    .eq("code", code)
    .order("version", { ascending: false });

  if (!versions?.length) return [];

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("plan_id")
    .in(
      "plan_id",
      versions.map((v) => v.id),
    )
    .neq("status", "cancelled");

  const countByPlan = new Map<string, number>();
  for (const row of subs ?? []) {
    countByPlan.set(row.plan_id, (countByPlan.get(row.plan_id) ?? 0) + 1);
  }

  return versions.map((v) => ({ ...v, subscriber_count: countByPlan.get(v.id) ?? 0 })) as PlanVersionRow[];
}
