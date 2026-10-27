import { redirect } from "next/navigation";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { BusinessProfileForm, type BusinessProfileInitial } from "@/components/app/business-profile-form";
import { LogoutButton } from "@/components/app/logout-button";
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
    .select("business_name, primary_state, products_sold, monthly_volume_range, lead_sources, lead_source_other")
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const initial: BusinessProfileInitial | null = data
    ? {
        businessName: data.business_name,
        primaryState: data.primary_state,
        productsSold: data.products_sold,
        monthlyVolumeRange: data.monthly_volume_range,
        leadSources: data.lead_sources,
        leadSourceOther: data.lead_source_other,
      }
    : null;

  // Back goes to step 2, which shows the address as confirmed and comes straight back here (owner,
  // 2026-10-27: "we don't have a back button anywhere"). Signing out stays beside the address.
  return (
    <FunnelFrame step={3} wide back={{ href: "/app/verify-email", label: "Back to your email" }}>
      <BusinessProfileForm initial={initial} />
      <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-normal text-muted-foreground">
        <span>Signed in as <span className="font-semibold text-foreground">{context.email}</span></span>
        <span aria-hidden="true">·</span>
        <LogoutButton variant="link" className="text-sm font-semibold text-foreground hover:text-[var(--accent-ink)]" />
      </p>
    </FunnelFrame>
  );
}
