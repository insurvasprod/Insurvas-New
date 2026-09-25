import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { daysUntilExpiry } from "@/lib/appointments/warnings";

/**
 * The few workspace facts the settings frame shows around its sections: the plan by name rather
 * than code, how it is billed and when it renews, when the workspace was made, and how many agency
 * licences run out inside 90 days (the badge beside "States & licences").
 *
 * Read-only, and every read is independent, so they go out together. A failed read yields null
 * rather than throwing: this is garnish around the page, and a missing renewal date must not take
 * the settings a person came to change down with it.
 */
export type WorkspaceSnapshot = {
  tenantId: string;
  tenantName: string | null;
  createdAt: string | null;
  planName: string | null;
  billingMode: "automatic" | "manual" | null;
  renewsAt: string | null;
  licencesExpiringSoon: number;
};

export async function getWorkspaceSnapshot(tenantId: string, planCode: string | null): Promise<WorkspaceSnapshot> {
  const supabase = getSupabaseServiceClient();
  const now = new Date();

  const [tenant, plan, subscription, licences] = await Promise.all([
    supabase.from("tenants").select("name, created_at, billing_mode").eq("id", tenantId).maybeSingle<{ name: string; created_at: string; billing_mode: "automatic" | "manual" }>(),
    planCode
      ? supabase.from("plans").select("name, version").eq("code", planCode).order("version", { ascending: false }).limit(1).maybeSingle<{ name: string; version: number }>()
      : Promise.resolve({ data: null }),
    supabase
      .from("subscriptions")
      .select("current_period_end, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ current_period_end: string | null; status: string; created_at: string }>(),
    supabase.from("licenses").select("expires_at").eq("tenant_id", tenantId),
  ]);

  const licencesExpiringSoon = ((licences.data ?? []) as Array<{ expires_at: string }>).filter((row) => {
    const days = daysUntilExpiry(row.expires_at, now);
    return days >= 0 && days <= 90;
  }).length;

  return {
    tenantId,
    tenantName: tenant.data?.name ?? null,
    createdAt: tenant.data?.created_at ?? null,
    planName: plan.data?.name ?? null,
    billingMode: tenant.data?.billing_mode ?? null,
    renewsAt: subscription.data?.current_period_end ?? null,
    licencesExpiringSoon,
  };
}
