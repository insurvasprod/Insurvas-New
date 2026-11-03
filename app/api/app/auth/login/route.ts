import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { tenantLoginSchema } from "@/lib/tenantAuth/schemas";
import { verifyTenantSignInLinkToken } from "@/lib/tenantAuth/session";
import { completeTenantSignIn, GENERIC_ERROR, LINK_ERROR, signInFailure } from "@/lib/tenantAuth/completeSignIn";
import { getMaintenanceStatus } from "@/lib/system/service";
import { checkLoginAllowed, logBlockedLoginAttempt, loginRateLimitResponse } from "@/lib/authProtection";

/**
 * Agent sign-in, first factor: the password, or an emailed link that stands in for it. The rest is
 * completeTenantSignIn, shared with every other way in.
 */

function getAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase Auth environment configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json(
      {
        error: maintenance.message ?? "The platform is temporarily locked for maintenance. Please try again later.",
        code: "maintenance_locked",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = tenantLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // An emailed sign-in link stands in for the password (2026-10-24). Its token names the person, so
  // the same per-address lockout applies to it before anything is looked up.
  const link = "link" in parsed.data ? await verifyTenantSignInLinkToken(parsed.data.link) : null;
  if ("link" in parsed.data && !link) return NextResponse.json(LINK_ERROR, { status: 401 });
  const email = link ? link.email : "email" in parsed.data ? parsed.data.email : "";
  const remember = link ? (parsed.data.remember ?? link.remember) : parsed.data.remember !== false;
  const protection = await checkLoginAllowed("user", email, request);
  if (!protection.allowed) {
    // Scheduled after the response and capped; never delays or changes the refusal.
    logBlockedLoginAttempt("user", email, request, protection);
    return NextResponse.json(GENERIC_ERROR, loginRateLimitResponse(protection.retryAfterSeconds));
  }

  const fail = signInFailure(request, email);

  let authUserId: string;
  if (link) {
    authUserId = link.sub;
  } else {
    const password = "password" in parsed.data ? parsed.data.password : "";
    const { data: authData, error: authError } = await getAuthClient().auth.signInWithPassword({ email, password });
    if (authError || !authData.user) {
      return fail("invalid_credentials", null, NextResponse.json(GENERIC_ERROR, { status: 401 }));
    }
    authUserId = authData.user.id;
  }

  // Past the first factor, every way in shares one path (lib/tenantAuth/completeSignIn.ts): the user
  // row, the partner plane, suspension, two-factor and the session.
  return completeTenantSignIn({ request, authUserId, email, remember, via: link ? "link" : "password", link });
}
