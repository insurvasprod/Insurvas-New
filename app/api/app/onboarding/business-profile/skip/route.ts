import { NextResponse } from "next/server";

import { resolveSignupContext } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST() {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "active" || context.onboardingState !== "business_profile") {
    return NextResponse.json({ error: "Business setup can only be skipped after checkout" }, { status: 409 });
  }
  const { data, error } = await getSupabaseServiceClient().rpc("skip_signup_business_profile", { p_user_id: context.userId });
  if (error || !data?.[0]) {
    console.error("Could not skip signup business profile", error?.code, error?.message);
    return NextResponse.json({ error: "Could not finish setup right now. Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, redirectTo: "/app/onboarding/complete" });
}
