import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function getDashboardOnboardingState(tenantId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenants")
    .select("onboarding_state")
    .eq("id", tenantId)
    .maybeSingle<{ onboarding_state: string }>();

  if (error || !data) throw new Error("Could not load dashboard setup state");
  return data.onboarding_state;
}
