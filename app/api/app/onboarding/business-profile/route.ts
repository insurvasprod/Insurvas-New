import { NextResponse, type NextRequest } from "next/server";

import { deriveRecommendedSetupSteps } from "@/lib/signup/constants";
import { resolveSignupContext } from "@/lib/signup/context";
import { businessProfileSchema } from "@/lib/signup/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "active" || !["business_profile", "ready_for_checkout"].includes(context.onboardingState)) {
    return NextResponse.json({ error: "Verify your email before completing the business profile" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const parsed = businessProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid business profile" }, { status: 400 });
  }

  const profile = parsed.data;
  const setupSteps = deriveRecommendedSetupSteps(profile);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("save_signup_business_profile", {
    p_user_id: context.userId,
    p_business_name: profile.businessName,
    p_npn: profile.npn,
    p_primary_state: profile.primaryState,
    p_products_sold: profile.productsSold,
    p_monthly_volume_range: profile.monthlyVolumeRange,
    p_lead_sources: profile.leadSources,
    p_lead_source_other: profile.leadSourceOther ?? "",
    p_recommended_setup_steps: setupSteps,
  });

  if (error || !data?.[0]) {
    console.error("Could not save signup business profile", error?.code, error?.message);
    return NextResponse.json({ error: "Could not save your business profile" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, redirectTo: "/app/checkout", setupSteps });
}
