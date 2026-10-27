import { NextResponse, type NextRequest } from "next/server";

import { deriveRecommendedSetupSteps } from "@/lib/signup/constants";
import { resolveSignupContext } from "@/lib/signup/context";
import { aboutYouSchema, businessProfileSchema } from "@/lib/signup/schemas";
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
  const supabase = getSupabaseServiceClient();
  const { data: existingSubscription } = await supabase.from("subscriptions").select("id")
    .eq("tenant_id", context.tenantId).in("status", ["trialing", "active"]).limit(1).maybeSingle();
  const postPayment = context.onboardingState === "business_profile" && Boolean(existingSubscription);
  const personal = postPayment ? null : aboutYouSchema.safeParse(body);
  if (personal && !personal.success) {
    return NextResponse.json({ error: personal.error.issues[0]?.message ?? "Check your personal details" }, { status: 400 });
  }
  const setupSteps = deriveRecommendedSetupSteps(profile);
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

  if (personal?.success) {
    const fullName = `${personal.data.firstName} ${personal.data.lastName}`;
    const { error: userError } = await supabase.from("users").update({ name: fullName, phone: personal.data.phone }).eq("id", context.userId);
    if (userError) {
      console.error("Could not save signup personal details", userError.code, userError.message);
      return NextResponse.json({ error: "Your business profile was saved, but your personal details could not be saved. Try again." }, { status: 500 });
    }
    const { error: tenantError } = await supabase.from("tenants").update({ name: `${fullName}'s Workspace` })
      .eq("id", context.tenantId).eq("name", "New user's Workspace");
    if (tenantError) {
      console.error("Could not update the new workspace name", tenantError.code, tenantError.message);
      return NextResponse.json({ error: "Your personal details were saved, but the workspace name could not be updated. Try again." }, { status: 500 });
    }
  }

  if (data[0].onboarding_state === "completed") return NextResponse.json({ ok: true, redirectTo: "/app/onboarding/complete", setupSteps });

  // A Pricing selection is already a plan decision; continue to checkout. Free-trial entry still
  // visits the chooser. If this optional read fails, keep the safe chooser path.
  const { data: selection, error: selectionError } = await supabase.from("signup_selections")
    .select("selected_from_pricing").eq("tenant_id", context.tenantId).maybeSingle();
  if (selectionError) console.error("Could not read signup plan intent", selectionError.code, selectionError.message);
  const redirectTo = selection?.selected_from_pricing ? "/app/checkout" : "/app/onboarding/plan";
  return NextResponse.json({ ok: true, redirectTo, setupSteps });
}
