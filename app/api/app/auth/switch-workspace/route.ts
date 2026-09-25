import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { signTenantSessionToken, tenantSessionCookieOptions, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { verifiedMembership } from "@/lib/tenantAuth/workspaceService";
import { signupDestination } from "@/lib/signup/context";
import { isTenantSuspended, TENANT_SUSPENDED_CODE, TENANT_SUSPENDED_MESSAGE } from "@/lib/tenants/suspension";

const bodySchema = z.object({ tenantId: z.string().uuid() }).strict();

/**
 * Switch workspace: re-issue the tenant session for another workspace this person belongs to.
 *
 * The browser only names the workspace. Everything that decides whether it may be opened is read
 * here: the current session must still resolve (active account, current session version), the
 * target membership must be this user's own and accepted, and the workspace must exist. The new
 * token carries the same session version, so "sign out everywhere" still ends it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a workspace to open." }, { status: 400 });
  const { tenantId } = parsed.data;
  if (tenantId === auth.context.tenantId) return NextResponse.json({ error: "You are already in that workspace." }, { status: 409 });

  try {
    const supabase = getSupabaseServiceClient();
    const [membership, { data: user }, { data: tenant }] = await Promise.all([
      verifiedMembership(auth.context.userId, tenantId),
      supabase.from("users").select("status, session_version").eq("id", auth.context.userId).maybeSingle<{ status: string; session_version: number }>(),
      supabase.from("tenants").select("status, onboarding_state").eq("id", tenantId).maybeSingle<{ status: string; onboarding_state: string }>(),
    ]);
    // One answer for "not yours", "not accepted" and "does not exist": the difference is not this
    // caller's to learn.
    if (!membership || !tenant) return NextResponse.json({ error: "That workspace is not one you can open." }, { status: 403 });
    // Their own membership, so saying why is fine: a suspended agency cannot be opened (decision 4).
    if (isTenantSuspended(tenant.status)) {
      return NextResponse.json({ error: TENANT_SUSPENDED_MESSAGE, code: TENANT_SUSPENDED_CODE }, { status: 403 });
    }
    if (!user || user.status !== "active") return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const token = await signTenantSessionToken(auth.context.userId, tenantId, user.session_version);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.workspace_switched",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { fromTenantId: auth.context.tenantId, toTenantId: tenantId, role: membership.role },
      request,
    });
    const response = NextResponse.json({
      ok: true,
      redirectTo: signupDestination({ userStatus: user.status, onboardingState: tenant.onboarding_state }) ?? "/app/dashboard",
    });
    response.cookies.set(TENANT_SESSION_COOKIE, token, tenantSessionCookieOptions);
    return response;
  } catch {
    return NextResponse.json({ error: "That workspace could not be opened right now. You are still signed in here." }, { status: 503 });
  }
}
