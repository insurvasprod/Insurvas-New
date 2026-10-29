import { NextResponse, type NextRequest } from "next/server";

import { aboutYouSchema } from "@/lib/signup/schemas";
import { resolveSignupContext } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The About you step after payment (and older accounts still on the pre-payment About you screen). */
const ABOUT_YOU_STATES = new Set(["about_you", "ready_for_checkout", "awaiting_payment", "business_profile"]);

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "active" || !ABOUT_YOU_STATES.has(context.onboardingState)) {
    return NextResponse.json({ error: "Finish email verification before saving your details" }, { status: 409 });
  }

  const parsed = aboutYouSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check your details" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("save_signup_about_you", {
    p_user_id: context.userId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_phone: parsed.data.phone,
  });
  if (error || !data?.[0]) {
    console.error("Could not save signup About you", error?.code, error?.message);
    return NextResponse.json({ error: "Could not save your details" }, { status: 500 });
  }

  const { data: selection, error: selectionError } = await supabase.from("signup_selections")
    .select("selected_from_pricing").eq("tenant_id", context.tenantId).maybeSingle();
  if (selectionError) console.error("Could not read signup plan intent", selectionError.code, selectionError.message);
  if (data[0].onboarding_state === "business_profile") return NextResponse.json({ ok: true, redirectTo: "/app/onboarding/business-profile" });
  return NextResponse.json({ ok: true, redirectTo: selection?.selected_from_pricing ? "/app/checkout" : "/app/onboarding/plan" });
}
