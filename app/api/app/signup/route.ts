import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { hashPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { signTenantSessionToken, tenantSessionCookieOptions, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { recordLoginEvent } from "@/lib/loginEvents/record";

const signupSchema = z.object({
  workspaceName: z.string().trim().min(2, "Enter a workspace name").max(160),
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(12, "Use a password with at least 12 characters").max(200),
  planId: z.string().uuid("Choose an available plan"),
  billingCycle: z.enum(["monthly", "quarterly", "yearly"]),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const supabase = getSupabaseServiceClient();

  const { data: allowed, error: rateLimitError } = await supabase.rpc("claim_rate_limit", {
    p_key: `tenant-signup:${ip}`,
    p_max: 5,
    p_window_seconds: 3600,
  });
  if (rateLimitError || allowed === false) {
    return NextResponse.json({ error: "Too many signup attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check the signup form" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const { data, error } = await supabase.rpc("self_serve_signup_with_subscription", {
    p_tenant_name: parsed.data.workspaceName,
    p_owner_name: parsed.data.fullName,
    p_owner_email: parsed.data.email,
    p_owner_password_hash: passwordHash,
    p_plan_id: parsed.data.planId,
    p_billing_cycle: parsed.data.billingCycle,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "An account with this email already exists. Try signing in instead." }, { status: 409 });
    }
    if (error.message.includes("plan_not_available")) {
      return NextResponse.json({ error: "That subscription is no longer available. Refresh the page and choose another." }, { status: 409 });
    }
    if (error.message.includes("billing_cycle_not_available")) {
      return NextResponse.json({ error: "That billing cycle is not available for this plan. Refresh the page and choose another." }, { status: 409 });
    }
    console.error("tenant signup failed", error);
    return NextResponse.json({ error: "We could not create your workspace right now. Please try again." }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.tenant_id || !result.user_id) {
    console.error("tenant signup returned no created account");
    return NextResponse.json({ error: "We could not confirm the new workspace. Please try again." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  await recordLoginEvent({ request, email: parsed.data.email, success: true, userId: result.user_id, actorType: "user" });
  response.cookies.set(
    TENANT_SESSION_COOKIE,
    await signTenantSessionToken(result.user_id, result.tenant_id),
    tenantSessionCookieOptions,
  );
  return response;
}
