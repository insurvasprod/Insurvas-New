import { NextResponse, type NextRequest } from "next/server";

import { deriveRecommendedSetupSteps } from "@/lib/signup/constants";
import { resolveSignupContext } from "@/lib/signup/context";
import { businessProfileSchema } from "@/lib/signup/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // awaiting_payment too: the owner may correct the profile while checkout is pending. The RPC keeps
  // that state (migration 20261015580000), so the open checkout is not lost.
  if (context.userStatus !== "active" || !["business_profile", "ready_for_checkout", "awaiting_payment"].includes(context.onboardingState)) {
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
    // Empty is stored as null (migration 20261026200000) and keeps an NPN already on the row.
    p_npn: profile.npn ?? "",
    p_primary_state: profile.primaryState,
    p_products_sold: profile.productsSold,
    p_monthly_volume_range: profile.monthlyVolumeRange,
    p_lead_sources: profile.leadSources,
    p_lead_source_other: profile.leadSourceOther ?? "",
    p_recommended_setup_steps: setupSteps,
  });

  // Before migration 20261015580000 is live the RPC still refuses awaiting_payment: say so, not "500".
  if (error?.message?.includes("BUSINESS_PROFILE_NOT_AVAILABLE")) {
    return NextResponse.json({ error: "Your business profile cannot be changed at this step. Finish checkout, then update it in Settings." }, { status: 409 });
  }
  // Before migration 20261026200000 is live business_profiles.npn is still NOT NULL (or its check refuses "").
  if (error && (error.code === "23502" || error.code === "23514") && /npn/i.test(error.message ?? "")) {
    console.error("Signup without an NPN needs migration 20261026200000", error.code, error.message);
    return NextResponse.json({ error: "Could not save your business profile yet. Please try again shortly." }, { status: 503 });
  }
  if (error || !data?.[0]) {
    console.error("Could not save signup business profile", error?.code, error?.message);
    return NextResponse.json({ error: "Could not save your business profile" }, { status: 500 });
  }

  // Step 4 of 5 is the plan (owner, 2026-10-26), then Payment.
  return NextResponse.json({ ok: true, redirectTo: "/app/onboarding/plan", setupSteps });
}
