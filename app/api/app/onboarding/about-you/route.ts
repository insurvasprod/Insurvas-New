import { NextResponse, type NextRequest } from "next/server";

import { aboutYouSchema } from "@/lib/signup/schemas";
import { resolveSignupContext } from "@/lib/signup/context";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "active" || context.onboardingState !== "about_you") {
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
  return NextResponse.json({ ok: true, redirectTo: selection?.selected_from_pricing ? "/app/checkout" : "/app/onboarding/plan" });
}
