import { NextResponse, type NextRequest } from "next/server";

import { hashInviteToken } from "@/lib/users/invitations";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  tenantSessionCookieOptions,
  TENANT_SESSION_COOKIE,
} from "@/lib/tenantAuth/session";
import { issueTenantSession } from "@/lib/tenantAuth/sessionStore";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/verification-failed", request.url));

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("complete_signup_email_verification", {
    p_token_hash: hashInviteToken(token),
  });
  const verified = data?.[0];
  if (error || !verified) {
    return NextResponse.redirect(new URL("/verification-failed", request.url));
  }

  // A session row like every other sign-in (LA-8.2), so the owner can see and end it.
  const { token: session } = await issueTenantSession({ userId: verified.user_id, tenantId: verified.tenant_id, sessionVersion: 0, request });
  const response = NextResponse.redirect(new URL("/app/onboarding/plan?verified=1", request.url));
  response.cookies.set(TENANT_SESSION_COOKIE, session, tenantSessionCookieOptions);
  return response;
}
