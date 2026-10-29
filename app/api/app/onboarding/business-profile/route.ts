import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { deriveRecommendedSetupSteps } from "@/lib/signup/constants";
import { resolveSignupContext } from "@/lib/signup/context";
import { PROFILE_EDITABLE_STATES, signupDestination } from "@/lib/signup/destination";
import { businessProfileSchema } from "@/lib/signup/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  // Before, during and after payment (migration 20261028200000): the profile is asked after checkout
  // and at first login, and the RPC never moves a tenant backwards.
  if (context.userStatus !== "active" || !(PROFILE_EDITABLE_STATES as readonly string[]).includes(context.onboardingState)) {
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

  // About you (manager review, 2026-10-28): step 1 is only email and password, so the person's name
  // and phone are saved here. Left out (a profile corrected from checkout by an older page), they stay.
  if (profile.firstName && profile.lastName) {
    const fullName = `${profile.firstName} ${profile.lastName}`;
    // Untyped, like lib/users/ownProfileService.ts: the generated types leave these columns read-only.
    const { error: personError } = await (supabase as unknown as SupabaseClient)
      .from("users")
      .update({ name: fullName, full_name: fullName, display_name: fullName, ...(profile.phone ? { phone: profile.phone } : {}), updated_at: new Date().toISOString() })
      .eq("id", context.userId);
    if (personError) {
      console.error("Could not save the signup name and phone", personError.code, personError.message);
      return NextResponse.json({ error: "Could not save your details. Try again." }, { status: 500 });
    }
    // The Auth identity carries the name too (it is set at sign-up from the address until now).
    await supabase.auth.admin.updateUserById(context.userId, { user_metadata: { name: fullName, full_name: fullName } }).catch(() => {});
  }
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

  // Wherever the sign-up stands after saving: the plan or checkout if payment is still to come, the
  // app once the plan has started (payment comes first since migration 20261028200000).
  const savedState = String(data[0].onboarding_state ?? context.onboardingState);
  return NextResponse.json({ ok: true, redirectTo: signupDestination({ userStatus: "active", onboardingState: savedState }) ?? "/app/dashboard", setupSteps });
}
