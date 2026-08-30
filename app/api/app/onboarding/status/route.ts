import { NextResponse } from "next/server";

import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = getSupabaseServiceClient();
  const [{ data: selection }, { data: profile }] = await Promise.all([
    supabase
      .from("signup_selections")
      .select("plan_id, billing_cycle")
      .eq("tenant_id", context.tenantId)
      .maybeSingle(),
    supabase
      .from("business_profiles")
      .select("business_name, recommended_setup_steps")
      .eq("tenant_id", context.tenantId)
      .maybeSingle(),
  ]);

  const { data: plan } = selection
    ? await supabase.from("plans").select("code, name").eq("id", selection.plan_id).maybeSingle()
    : { data: null };

  return NextResponse.json({
    email: context.email,
    name: context.name,
    userStatus: context.userStatus,
    onboardingState: context.onboardingState,
    destination: signupDestination(context),
    selection: selection && plan
      ? { planCode: plan.code, planName: plan.name, billingCycle: selection.billing_cycle }
      : null,
    profile: profile
      ? { businessName: profile.business_name, recommendedSetupSteps: profile.recommended_setup_steps }
      : null,
  });
}
