import { redirect } from "next/navigation";

import { FunnelFrame } from "@/components/app/funnel-frame";
import { BusinessProfileForm, type AboutYouInitial, type BusinessProfileInitial } from "@/components/app/business-profile-form";
import { audienceForPlanType } from "@/lib/agency/constants";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { PROFILE_EDITABLE_STATES } from "@/lib/signup/destination";
import { PROFILE_SKIP_PATH } from "@/lib/signup/profileSkip";
import { nameFromEmail } from "@/lib/signup/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** States in which the profile may be (re)written: before, during and after payment (migration 20261028200000). */
const EDITABLE = new Set<string>(PROFILE_EDITABLE_STATES);

/** Who is signing up, from the plan picked on the pricing page (or the default one): one agent or an agency. */
async function signupAudience(tenantId: string): Promise<"individual" | "agency"> {
  const supabase = getSupabaseServiceClient();
  const { data: selection } = await supabase.from("signup_selections").select("plan_id").eq("tenant_id", tenantId).maybeSingle();
  if (!selection?.plan_id) return "agency";
  const { data: plan } = await supabase.from("plans").select("plan_type").eq("id", selection.plan_id).maybeSingle();
  return audienceForPlanType(plan?.plan_type) ?? "agency";
}

export default async function BusinessProfilePage({ searchParams }: { searchParams: Promise<{ finish?: string }> }) {
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
  // After payment this is the last step; an owner who already filled it goes straight to the app.
  // Sent here by the shell's first-login gate: the owner skipped this at sign-up.
  const gate = (await searchParams).finish === "1" && context.onboardingState === "completed";
  const paid = context.onboardingState === "completed";
  if (paid && data) redirect("/app/dashboard");

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

  // Step 5 of 5, after payment (manager review, 2026-10-28). Back is a button beside Continue; once the
  // plan is paid there is no step to go back to, so it is left out. Before payment (someone who opened
  // this page directly) it goes to the plan.
  return (
    <FunnelFrame step={5} wide>
      <BusinessProfileForm
        initial={initial}
        person={person}
        audience={audience}
        back={paid ? undefined : "/app/onboarding/plan"}
        // After payment the owner may skip it for now; it is asked again at the next login.
        // The first-login gate (?finish=1, lib/signup/profileGate.ts) blocks: no Skip there.
        skipHref={paid && !gate ? PROFILE_SKIP_PATH : undefined}
        gate={gate}
      />
    </FunnelFrame>
  );
}
