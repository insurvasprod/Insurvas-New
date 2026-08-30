import { NextResponse, type NextRequest } from "next/server";

import { sendVerificationEmail } from "@/lib/email/sendVerificationEmail";
import { hashPassword } from "@/lib/password";
import { fetchPlans } from "@/lib/plans/queries";
import { publicSignupSchema } from "@/lib/signup/schemas";
import { buildVerificationUrl, createEmailVerification } from "@/lib/signup/verification";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  signTenantSessionToken,
  tenantSessionCookieOptions,
  TENANT_SESSION_COOKIE,
} from "@/lib/tenantAuth/session";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = publicSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid signup details" }, { status: 400 });
  }

  const input = parsed.data;
  const plan = (await fetchPlans({ includeArchived: false })).find(
    (candidate) => candidate.code === input.planCode && candidate.is_public,
  );
  if (!plan) return NextResponse.json({ error: "That plan is no longer available" }, { status: 409 });

  const verification = createEmailVerification();
  const passwordHash = await hashPassword(input.password);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("self_serve_signup", {
    p_name: input.fullName,
    p_email: input.email,
    p_password_hash: passwordHash,
    p_phone: input.phone,
    p_plan_id: plan.id,
    p_billing_cycle: input.billingCycle,
    p_token_hash: verification.tokenHash,
    p_expires_at: verification.expiresAt.toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An account already exists for that email address" }, { status: 409 });
    }
    if (error.message.includes("PLAN_UNAVAILABLE") || error.message.includes("BILLING_CYCLE_UNAVAILABLE")) {
      return NextResponse.json({ error: "That plan or billing cycle is no longer available" }, { status: 409 });
    }
    console.error("Self-serve signup failed", error.code, error.message);
    return NextResponse.json({ error: "Could not create your account" }, { status: 500 });
  }

  const created = data?.[0];
  if (!created) return NextResponse.json({ error: "Could not create your account" }, { status: 500 });

  const delivery = await sendVerificationEmail({
    email: input.email,
    name: input.fullName,
    verificationUrl: buildVerificationUrl(verification.token, request.nextUrl.origin),
    verificationId: created.verification_id,
  });

  const token = await signTenantSessionToken(created.user_id, created.tenant_id);
  const response = NextResponse.json({
    ok: true,
    email: input.email,
    emailDelivered: delivery.delivered,
    redirectTo: "/app/verify-email",
  });
  response.cookies.set(TENANT_SESSION_COOKIE, token, tenantSessionCookieOptions);
  return response;
}
