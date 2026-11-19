import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Live subscribers on each given plan version (admin_plan_list counts every version of a code), so a page can say
 * how many are still on an older one — the same "live" rule as the view: anything not cancelled. Paged past
 * PostgREST's 1,000-row cap. Throws on a failed read.
 */
export async function fetchSubscribersByVersion(planIds: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (planIds.length === 0) return counts;
  const db = getSupabaseServiceClient();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("subscriptions").select("plan_id").in("plan_id", [...planIds]).neq("status", "cancelled").order("id").range(from, from + 999);
    if (error) throw new Error(`Could not count subscribers per version: ${error.message}`);
    for (const row of data ?? []) counts[row.plan_id] = (counts[row.plan_id] ?? 0) + 1;
    if (!data || data.length < 1000) return counts;
  }
}
