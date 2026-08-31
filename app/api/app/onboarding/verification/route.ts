import { NextResponse, type NextRequest } from "next/server";

import { VERIFICATION_RESEND, claim, retryAfterSeconds } from "@/lib/rateLimit";

import { sendVerificationEmail } from "@/lib/email/sendVerificationEmail";
import { resolveSignupContext } from "@/lib/signup/context";
import { verificationActionSchema } from "@/lib/signup/schemas";
import { buildVerificationUrl, createEmailVerification } from "@/lib/signup/verification";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const context = await resolveSignupContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (context.userStatus !== "pending_verification") {
    return NextResponse.json({ error: "Your email is already verified" }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const parsed = verificationActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  // The SQL side already enforces a 60-second cooldown, but `change_email` sends to an ARBITRARY
  // address — so without an hourly cap an authenticated account is a mail relay pointed at anyone,
  // at roughly sixty messages an hour from our sending domain.
  const limited = await claim(VERIFICATION_RESEND, context.userId);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many verification emails requested. Please try again later." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } },
    );
  }

  const verification = createEmailVerification();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("refresh_signup_verification", {
    p_user_id: context.userId,
    p_new_email: parsed.data.action === "change_email" ? parsed.data.email : "",
    p_token_hash: verification.tokenHash,
    p_expires_at: verification.expiresAt.toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An account already exists for that email address" }, { status: 409 });
    }
    if (error.message.includes("VERIFICATION_RESEND_TOO_SOON")) {
      return NextResponse.json({ error: "Please wait one minute before requesting another email" }, { status: 429 });
    }
    console.error("Could not refresh email verification", error.code, error.message);
    return NextResponse.json({ error: "Could not create a new verification link" }, { status: 500 });
  }

  const refreshed = data?.[0];
  if (!refreshed) return NextResponse.json({ error: "Could not create a new verification link" }, { status: 500 });

  const delivery = await sendVerificationEmail({
    email: refreshed.email,
    name: context.name,
    verificationUrl: buildVerificationUrl(verification.token),
    verificationId: refreshed.verification_id,
  });
  if (!delivery.delivered) {
    return NextResponse.json(
      { error: "We saved the request, but the email provider could not deliver it. Try again shortly." },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, email: refreshed.email });
}
