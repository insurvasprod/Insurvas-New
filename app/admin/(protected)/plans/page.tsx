import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PlansTable } from "@/components/admin/plans-table";

export default async function PlansPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const plans = await fetchPlans();
  const latestIds = plans.map((p) => p.id);
  const [priceMap, latestSubs] = await Promise.all([
    fetchPricesForPlans(latestIds),
    // Live subscribers on each LATEST version (admin_plan_list counts every version of the code),
    // so the page can say how many are still on an older one — the same "live" rule as the view.
    latestIds.length
      ? getSupabaseServiceClient().from("subscriptions").select("plan_id").in("plan_id", latestIds).neq("status", "cancelled")
      : Promise.resolve({ data: [] as { plan_id: string }[], error: null }),
  ]);
  if (latestSubs.error) throw new Error(`Could not count subscribers per version: ${latestSubs.error.message}`);

  const latestSubscribers: Record<string, number> = {};
  for (const row of latestSubs.data ?? []) latestSubscribers[row.plan_id] = (latestSubscribers[row.plan_id] ?? 0) + 1;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PlansTable plans={plans} prices={Object.fromEntries(priceMap)} latestSubscribers={latestSubscribers} />
    </div>
  );
}
