import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveSignupContext } from "@/lib/signup/context";

export async function getDashboardOnboardingState(tenantId: string): Promise<string> {
  // The shell's signup gate already read tenants.onboarding_state for this request, memoised; reuse
  // it rather than asking again. Only when it is for this same tenant — otherwise read it directly.
  const signup = await resolveSignupContext();
  if (signup && signup.tenantId === tenantId) return signup.onboardingState;

  const { data, error } = await getSupabaseServiceClient()
    .from("tenants")
    .select("onboarding_state")
    .eq("id", tenantId)
    .maybeSingle<{ onboarding_state: string }>();

  if (error || !data) throw new Error("Could not load dashboard setup state");
  return data.onboarding_state;
}
