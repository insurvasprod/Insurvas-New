import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SIGNUP_PER_EMAIL, SIGNUP_PER_IP, callerIp, claimAll, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { fetchPlans } from "@/lib/plans/queries";
import { availableBillingCycles, BILLING_CYCLES, type BillingCycle, type PlanPrices } from "@/lib/money";
import { createEmailVerification } from "@/lib/signup/verification";
import { checkInternationalPhone } from "@/lib/signup/phone";
import { documentsRequiredAtSignup, recordAcceptances, verifySignupAcceptance } from "@/lib/legal/acceptance";
import { recordLastLogin } from "@/lib/loginEvents/record";
import { getSetting } from "@/lib/settings/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  GOOGLE_SIGNUP_COOKIE,
  googleSignupCookieOptions,
  tenantSessionCookieOptions,
  TENANT_SESSION_COOKIE,
  verifyGoogleSignupToken,
} from "@/lib/tenantAuth/session";
import { issueTenantSession } from "@/lib/tenantAuth/sessionStore";
import { recordSecurityEvent } from "@/lib/users/securityEvents";

/** What the finish step sends. Who the person is never comes from here: it is the signed cookie. */
const finishSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  phone: z.string().trim().min(7, "Enter a valid phone number").max(40).transform((value, ctx) => {
    const checked = checkInternationalPhone(value);
    if (!checked.ok) { ctx.addIssue({ code: "custom", message: checked.error }); return z.NEVER; }
    return checked.e164;
  }),
  acceptedDocumentIds: z.array(z.string().uuid()).max(5).default([]),
});

async function firstSoldCycle(planId: string): Promise<BillingCycle | null> {
  const { data } = await getSupabaseServiceClient().from("plan_prices").select("*").eq("plan_id", planId).maybeSingle<PlanPrices>();
  return availableBillingCycles(data)[0] ?? null;
}

/**
 * "Finish your account" after Google (2026-10-27). The same checks and the same workspace as the
 * email sign-up (app/api/public/signup/route.ts): the rate limit, the published terms, the plan,
 * `self_serve_signup_with_auth`. Two differences only: the Auth user is the one Google made, and the
 * address is confirmed at once with the same function the emailed link uses, because Google has
 * already proved it. So the person goes straight to step 3, Your agency.
 */
export async function POST(request: NextRequest) {
  const google = await verifyGoogleSignupToken(request.cookies.get(GOOGLE_SIGNUP_COOKIE)?.value ?? "");
  if (!google) {
    return NextResponse.json({ error: "Your Google sign-in has expired. Press Continue with Google again." }, { status: 401 });
  }

  const parsed = finishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check your details" }, { status: 400 });
  const input = parsed.data;

  const signupIpRule: RateLimitRule = { ...SIGNUP_PER_IP, max: await getSetting<number>("security.signup_per_ip_per_hour") };
  const limited = await claimAll([
    { rule: signupIpRule, subject: callerIp(request.headers) },
    { rule: SIGNUP_PER_EMAIL, subject: google.email },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } },
    );
  }

  const required = await documentsRequiredAtSignup();
  if (required.missing.length > 0) {
    console.error("[signup:google] blocked: no published legal documents for", required.missing.join(", "));
    return NextResponse.json({ error: "Signup is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
  const acceptance = verifySignupAcceptance(input.acceptedDocumentIds, required.documents);
  if (!acceptance.ok) return NextResponse.json({ error: acceptance.error }, { status: 400 });

  const publicPlans = (await fetchPlans({ includeArchived: false })).filter((candidate) => candidate.is_public);
  const plan = google.plan
    ? publicPlans.find((candidate) => candidate.code === google.plan)
    : publicPlans.find((candidate) => candidate.is_default) ?? publicPlans[0];
  if (!plan) return NextResponse.json({ error: "That plan is no longer available" }, { status: 409 });
  const billingCycle = BILLING_CYCLES.includes(google.cycle as BillingCycle) ? (google.cycle as BillingCycle) : await firstSoldCycle(plan.id);
  if (!billingCycle) return NextResponse.json({ error: "That plan is no longer available" }, { status: 409 });

  const supabase = getSupabaseServiceClient();
  const verification = createEmailVerification();
  const { data, error } = await supabase.rpc("self_serve_signup_with_auth", {
    p_auth_user_id: google.sub,
    p_name: input.fullName,
    p_email: google.email,
    p_phone: input.phone,
    p_plan_id: plan.id,
    p_billing_cycle: billingCycle,
    p_token_hash: verification.tokenHash,
    p_expires_at: verification.expiresAt.toISOString(),
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "An account already exists for that email address. Sign in instead." }, { status: 409 });
    if (error.message.includes("PLAN_UNAVAILABLE") || error.message.includes("BILLING_CYCLE_UNAVAILABLE")) {
      return NextResponse.json({ error: "That plan or billing cycle is no longer available" }, { status: 409 });
    }
    console.error("[signup:google] failed", error.code, error.message);
    return NextResponse.json({ error: "Could not create your account" }, { status: 500 });
  }
  const created = data?.[0];
  if (!created) return NextResponse.json({ error: "Could not create your account" }, { status: 500 });

  // An acceptance we failed to record is one we cannot prove (as in the email sign-up).
  try {
    await recordAcceptances(created.user_id, acceptance.documentIds, "signup", request);
  } catch (recordError) {
    console.error("[signup:google] acceptance could not be recorded for", created.user_id, recordError);
    return NextResponse.json({ error: "Your account was created but your acceptance could not be recorded. Please contact support." }, { status: 500 });
  }

  // Google proved the address: confirm it now with the function the emailed link calls, so the
  // account is active and step 2 is skipped. If that fails, the person lands on step 2 instead, which
  // still works (the link can be sent again from there).
  const { data: confirmed, error: confirmError } = await supabase.rpc("complete_signup_email_verification", { p_token_hash: verification.tokenHash });
  if (confirmError || !confirmed?.[0]) console.error("[signup:google] could not confirm the Google address", confirmError?.message);

  await Promise.all([
    recordLastLogin("user", created.user_id),
    recordSecurityEvent({ userId: created.user_id, tenantId: created.tenant_id, type: "signed_in_with_google", request }),
  ]);
  const { token } = await issueTenantSession({ userId: created.user_id, tenantId: created.tenant_id, sessionVersion: 0, request });
  const response = NextResponse.json({ ok: true, redirectTo: confirmed?.[0] ? "/app/onboarding/business-profile" : "/app/verify-email" });
  response.cookies.set(TENANT_SESSION_COOKIE, token, tenantSessionCookieOptions);
  response.cookies.set(GOOGLE_SIGNUP_COOKIE, "", { ...googleSignupCookieOptions, maxAge: 0 });
  return response;
}
