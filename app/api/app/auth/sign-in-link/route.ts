import { randomUUID } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { holdsPartnerMembership } from "@/lib/auth/planeSeparation";
import { sendSignInLinkEmail } from "@/lib/email/sendInvitationEmail";
import { callerIp, claim, retryAfterSeconds, type RateLimitRule } from "@/lib/rateLimit";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMaintenanceStatus } from "@/lib/system/service";
import { tenantSignInLinkRequestSchema } from "@/lib/tenantAuth/schemas";
import { SIGN_IN_LINK_MINUTES, signTenantSignInLinkToken } from "@/lib/tenantAuth/session";
import { configuredAppOrigin } from "@/lib/urls/origin";

/**
 * "Email me a sign-in link" from the agent sign-in page (2026-10-24).
 *
 * Built like "Forgot password": nothing in the response depends on whether the address has an
 * account — same body, same status — and the lookup and the email happen after the response is sent
 * (`after`), so the timing does not tell either. Limited per address and per caller before anything
 * is looked up, so nobody can use this to flood an inbox.
 *
 * The link goes to /app/login with the token in the fragment, so it never reaches a server log or a
 * Referer, and nothing happens until the person presses "Sign in" there: a mail scanner that opens
 * the link does not use it up. The sign-in itself is POST /api/app/auth/login, with every check a
 * password sign-in has (lockout, suspension, partner accounts, two-factor).
 *
 * Only an active agent account with an accepted workspace membership gets a link.
 */
const SENT = { ok: true };
const PER_CALLER: RateLimitRule = { name: "sign_in_link_request_ip", max: 20, windowSeconds: 3600 };
const PER_ADDRESS: RateLimitRule = { name: "sign_in_link_request", max: 5, windowSeconds: 3600 };

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json({ error: maintenance.message ?? "The platform is temporarily locked for maintenance.", code: "maintenance_locked" }, { status: 503 });
  }

  const parsed = tenantSignInLinkRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the email address you sign in with." }, { status: 400 });
  const { email, remember } = parsed.data;

  for (const [rule, subject] of [[PER_CALLER, callerIp(request.headers)], [PER_ADDRESS, email]] as const) {
    const limited = await claim(rule, subject);
    if (!limited.allowed) {
      return NextResponse.json({ error: "Too many sign-in links asked for. Try again later, or use your password." }, { status: 429, headers: { "retry-after": String(retryAfterSeconds(limited.rule)) } });
    }
  }

  after(async () => {
    try {
      await issueLink(email, remember);
    } catch (error) {
      console.error("Could not issue a sign-in link", error instanceof Error ? error.message : error);
    }
  });
  return NextResponse.json(SENT);
}

async function issueLink(email: string, remember: boolean) {
  const supabase = getSupabaseServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("id, name, email, status, session_version, last_login_at")
    .eq("email", email)
    .maybeSingle<{ id: string; name: string; email: string; status: string; session_version: number; last_login_at: string | null }>();
  if (!user || user.status !== "active") return;

  const [{ count }, isPartner] = await Promise.all([
    supabase.from("tenant_users").select("user_id", { count: "exact", head: true }).eq("user_id", user.id).not("accepted_at", "is", null),
    holdsPartnerMembership(user.id),
  ]);
  if (!count || isPartner) return;

  const token = await signTenantSignInLinkToken({
    sub: user.id,
    email: user.email,
    sessionVersion: user.session_version,
    lastLoginAt: user.last_login_at,
    jti: randomUUID(),
    remember,
  });
  await sendSignInLinkEmail({
    to: user.email,
    name: user.name,
    signInUrl: `${configuredAppOrigin("agent")}/app/login#link=${encodeURIComponent(token)}`,
    minutes: SIGN_IN_LINK_MINUTES,
    userId: user.id,
  });
}
