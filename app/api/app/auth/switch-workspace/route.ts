import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getTenantSession, requireTenant } from "@/lib/tenantAuth/requireTenant";
import { continuedTenantSession, tenantSessionCookie, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { endTenantSessions, issueTenantSession } from "@/lib/tenantAuth/sessionStore";
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

    // A new session row for the other workspace, carrying over whether this browser passed the second
    // factor; the old row ends, so the person has one live session here, not two (LA-8.2).
    // ...and the "Keep me signed in" choice and expiry of the session it replaces.
    const carried = continuedTenantSession(await getTenantSession());
    const { token } = await issueTenantSession({ userId: auth.context.userId, tenantId, sessionVersion: user.session_version, request, twoFactorAt: auth.context.twoFactorAt ?? null, ...carried });
    if (auth.context.sessionId) await endTenantSessions({ userId: auth.context.userId, sessionId: auth.context.sessionId, reason: "switched_workspace", by: auth.context.userId });
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
    response.cookies.set(TENANT_SESSION_COOKIE, token, tenantSessionCookie(carried.remember, carried.maxAge));
    return response;
  } catch {
    return NextResponse.json({ error: "That workspace could not be opened right now. You are still signed in here." }, { status: 503 });
  }
}
