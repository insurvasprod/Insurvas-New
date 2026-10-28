import { redirect } from "next/navigation";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { BusinessProfileForm, type AboutYouInitial, type BusinessProfileInitial } from "@/components/app/business-profile-form";
import { audienceForPlanType } from "@/lib/agency/constants";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { nameFromEmail } from "@/lib/signup/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** States in which the profile may be (re)written: before checkout, and while checkout is pending. */
const EDITABLE = new Set(["business_profile", "ready_for_checkout", "awaiting_payment"]);

/** Who is signing up, from the plan picked on the pricing page (or the default one): one agent or an agency. */
async function signupAudience(tenantId: string): Promise<"individual" | "agency"> {
  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase.from("signup_selections").select("plan_id").eq("tenant_id", tenantId).maybeSingle();
  if (!selection?.plan_id) return "agency";
  const { data: plan } = await supabase.from("plans").select("plan_type").eq("id", selection.plan_id).maybeSingle();
  return audienceForPlanType(plan?.plan_type) ?? "agency";
}

export default async function BusinessProfilePage() {
  const context = await resolveSignupContext();
  if (!context) redirect("/app/login");
  const editable = context.userStatus === "active" && EDITABLE.has(context.onboardingState);
  const destination = signupDestination(context);
  if (!editable) redirect(destination ?? "/app/dashboard");

  const supabase = getSupabaseServiceClient();
  // Coming back from checkout to correct the profile: start from what was saved, not a blank form.
  const [{ data }, { data: user }, audience] = await Promise.all([
    supabase
      .from("business_profiles")
      .select("business_name, primary_state, products_sold, monthly_volume_range, lead_sources, lead_source_other")
      .eq("tenant_id", context.tenantId)
      .maybeSingle(),
    supabase.from("users").select("phone").eq("id", context.userId).maybeSingle(),
    signupAudience(context.tenantId),
  ]);
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

  // Step 1 named the account after its address; that stand-in is not shown as if it were typed.
  const realName = context.name && context.name !== nameFromEmail(context.email) ? context.name.trim() : "";
  const [firstName = "", ...rest] = realName ? realName.split(/\s+/) : [];
  const person: AboutYouInitial = { firstName, lastName: rest.join(" "), phone: user?.phone ?? "" };

  // Back is a button beside Continue, at the bottom (manager review, 2026-10-28); no link above the
  // heading and no Sign out under the form.
  return (
    <FunnelFrame step={3} wide>
      <BusinessProfileForm initial={initial} person={person} audience={audience} back="/app/verify-email" />
    </FunnelFrame>
  );
}
