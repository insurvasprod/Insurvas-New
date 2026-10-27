import { redirect } from "next/navigation";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { BusinessProfileForm, type BusinessProfileInitial } from "@/components/app/business-profile-form";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audienceForPlanType } from "@/lib/agency/constants";

/** States in which the profile may be (re)written: before checkout, and while checkout is pending. */
const EDITABLE = new Set(["business_profile", "ready_for_checkout", "awaiting_payment"]);

export default async function BusinessProfilePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const editable = context.userStatus === "active" && EDITABLE.has(context.onboardingState);
  const destination = signupDestination(context);
  if (!editable) redirect(destination ?? "/app/dashboard");

  // Coming back from checkout to correct the profile: start from what was saved, not a blank form.
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("business_profiles")
    .select("business_name, primary_state, products_sold, monthly_volume_range, lead_sources, lead_source_other")
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const [{ data: selection }, { data: subscription }] = await Promise.all([
    supabase.from("signup_selections").select("plan_id").eq("tenant_id", context.tenantId).maybeSingle(),
    supabase.from("subscriptions").select("id").eq("tenant_id", context.tenantId).in("status", ["trialing", "active"]).limit(1).maybeSingle(),
  ]);
  const { data: plan } = selection
    ? await supabase.from("plans").select("plan_type").eq("id", selection.plan_id).maybeSingle()
    : { data: null };
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

  const backHref = context.onboardingState === "business_profile"
    ? subscription ? undefined : "/app/verify-email?confirmed=1"
    : context.onboardingState === "awaiting_payment"
      ? "/app/checkout"
      : "/app/onboarding/plan";
  const postPayment = context.onboardingState === "business_profile" && Boolean(subscription);
  return <FunnelFrame step={postPayment ? 6 : 3} wide><BusinessProfileForm initial={initial} email={context.email} fullName={context.name} phone={context.phone ?? ""} backHref={backHref} audience={audienceForPlanType(plan?.plan_type)} postPayment={postPayment} /></FunnelFrame>;
}
