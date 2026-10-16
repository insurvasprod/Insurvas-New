import { redirect } from "next/navigation";

import { AuthPage } from "@/components/app/auth-card";
import { BusinessProfileForm, type BusinessProfileInitial } from "@/components/app/business-profile-form";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** States in which the profile may be (re)written: before checkout, and while checkout is pending. */
const EDITABLE = new Set(["business_profile", "ready_for_checkout", "awaiting_payment"]);

export default async function BusinessProfilePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const editable = context.userStatus === "active" && EDITABLE.has(context.onboardingState);
  const destination = signupDestination(context);
  if (!editable) redirect(destination ?? "/app/dashboard");

  // Coming back from checkout to correct the profile: start from what was saved, not a blank form.
  const { data } = await getSupabaseServiceClient()
    .from("business_profiles")
    .select("business_name, npn, primary_state, products_sold, monthly_volume_range, lead_sources, lead_source_other")
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const initial: BusinessProfileInitial | null = data
    ? {
        businessName: data.business_name,
        npn: data.npn,
        primaryState: data.primary_state,
        productsSold: data.products_sold,
        monthlyVolumeRange: data.monthly_volume_range,
        leadSources: data.lead_sources,
        leadSourceOther: data.lead_source_other,
      }
    : null;

  return <AuthPage><BusinessProfileForm initial={initial} /></AuthPage>;
}
