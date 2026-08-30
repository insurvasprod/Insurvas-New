import { NextResponse, type NextRequest } from "next/server";

import { hashInviteToken } from "@/lib/users/invitations";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  signTenantSessionToken,
  tenantSessionCookieOptions,
  TENANT_SESSION_COOKIE,
} from "@/lib/tenantAuth/session";

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

  const session = await signTenantSessionToken(verified.user_id, verified.tenant_id);
  const response = NextResponse.redirect(new URL("/app/onboarding/business-profile?verified=1", request.url));
  response.cookies.set(TENANT_SESSION_COOKIE, session, tenantSessionCookieOptions);
  return response;
}
