import { NextResponse, type NextRequest } from "next/server";

import { SIGNUP_PER_EMAIL, SIGNUP_PER_IP, callerIp, claimAll, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";

import { sendVerificationEmail } from "@/lib/email/sendVerificationEmail";
import { fetchPlans } from "@/lib/plans/queries";
import { publicSignupSchema } from "@/lib/signup/schemas";
import { buildVerificationUrl, createEmailVerification } from "@/lib/signup/verification";
import { documentsRequiredAtSignup, recordAcceptances, verifySignupAcceptance } from "@/lib/legal/acceptance";
import { recordLastLogin } from "@/lib/loginEvents/record";
import { getSetting } from "@/lib/settings/queries";
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

  // Before anything is created or sent. This endpoint is open to the internet and each call makes
  // a user, a tenant and an email from our sending domain — unthrottled, it is both a way to fill
  // the database and a way to use us to mail somebody repeatedly.
  const signupIpRule: RateLimitRule = {
    ...SIGNUP_PER_IP,
    max: await getSetting<number>("security.signup_per_ip_per_hour"),
  };
  const limited = await claimAll([
    { rule: signupIpRule, subject: callerIp(request.headers) },
    { rule: SIGNUP_PER_EMAIL, subject: input.email },
  ]);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again shortly." },
      { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } },
    );
  }

  // SA-5.4: checked before an account exists, and against what is published right now rather than
  // the ids the browser sent. A form left open while a new version was published must not record
  // agreement to the old text — the person would be agreeing to something that is no longer offered.
  const required = await documentsRequiredAtSignup();
  if (required.missing.length > 0) {
    console.error("[signup] blocked: no published legal documents for", required.missing.join(", "));
    return NextResponse.json(
      { error: "Signup is temporarily unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  const acceptance = verifySignupAcceptance(input.acceptedDocumentIds, required.documents);
  if (!acceptance.ok) return NextResponse.json({ error: acceptance.error }, { status: 400 });

  const plan = (await fetchPlans({ includeArchived: false })).find(
    (candidate) => candidate.code === input.planCode && candidate.is_public,
  );
  if (!plan) return NextResponse.json({ error: "That plan is no longer available" }, { status: 409 });

  const verification = createEmailVerification();
  const supabase = getSupabaseServiceClient();

  // LA-0.2 made Supabase Auth the credential authority for the tenant plane, and public.users.id
  // references auth.users(id). So the Auth identity is created FIRST and the password lives only
  // there -- the old path sent a bcrypt hash to self_serve_signup, which then could not supply an
  // id and failed 23502 on every signup. Same order as SA-1.2/1.3 and partner invitations.
  const authUser = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // The address is confirmed by our own token, sent below. Confirming here only tells Auth not to
    // send a second, competing email of its own.
    email_confirm: true,
    user_metadata: { name: input.fullName, full_name: input.fullName },
  });
  if (authUser.error || !authUser.data.user) {
    // Auth reports an existing address as a 422. It is the same answer as the RPC's EMAIL_EXISTS and
    // must not read as a server fault.
    if (authUser.error?.status === 422) {
      return NextResponse.json({ error: "An account already exists for that email address" }, { status: 409 });
    }
    console.error("[signup] auth identity could not be created", authUser.error?.message);
    return NextResponse.json({ error: "Could not create your account" }, { status: 500 });
  }

  const { data, error } = await supabase.rpc("self_serve_signup_with_auth", {
    p_auth_user_id: authUser.data.user.id,
    p_name: input.fullName,
    p_email: input.email,
    p_phone: input.phone,
    p_plan_id: plan.id,
    p_billing_cycle: input.billingCycle,
    p_token_hash: verification.tokenHash,
    p_expires_at: verification.expiresAt.toISOString(),
  });

  // The Auth identity is created before the workspace, so a failure below would strand one with no
  // profile attached -- and that address could then never sign up again. Remove it.
  if (error) await supabase.auth.admin.deleteUser(authUser.data.user.id).catch(() => {});

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

  // After the user exists and before they are let in. Throws rather than logs: an acceptance we
  // failed to record is one we cannot prove, and the account has just been created on the strength
  // of it.
  try {
    await recordAcceptances(created.user_id, acceptance.documentIds, "signup", request);
  } catch (recordError) {
    console.error("[signup] acceptance could not be recorded for", created.user_id, recordError);
    return NextResponse.json(
      { error: "Your account was created but your acceptance could not be recorded. Please contact support." },
      { status: 500 },
    );
  }

  const delivery = await sendVerificationEmail({
    email: input.email,
    name: input.fullName,
    verificationUrl: buildVerificationUrl(verification.token),
    verificationId: created.verification_id,
  });

  // Signup issues a session, which is a sign-in. Without this, last_login_at stays null for a user
  // who signed up and never used the login FORM — so SA-5.3's trials screen would report an
  // actively-engaged brand-new customer as "never signed in" and prompt a needless phone call.
  // Found by driving the whole journey in a browser.
  await recordLastLogin("user", created.user_id);

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
