import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { tenantSessionCookieOptions, TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { endTenantSessions, listTenantSessions } from "@/lib/tenantAuth/sessionStore";
import { AccountSecurityError, endOtherSessions } from "@/lib/users/accountSecurity";
import { recordSecurityEvent } from "@/lib/users/securityEvents";

/**
 * LA-8.2 · my sessions: every live one, with its device, rough location and last use, and the button
 * someone needs on the worst day of their year — end one, or every one but this. Ending is
 * store-checked: the ended session's next request is refused. Every role, own sessions only.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("end"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("end_others") }).strict(),
]);

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const sessions = await listTenantSessions(auth.context.userId, auth.context.sessionId ?? null);
  return NextResponse.json({ sessions, available: sessions !== null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a session to end." }, { status: 400 });
  const { userId, tenantId } = auth.context;
  try {
    if (parsed.data.action === "end") {
      if (parsed.data.id === auth.context.sessionId) return NextResponse.json({ error: "That is this session: sign out instead." }, { status: 400 });
      const ended = await endTenantSessions({ userId, sessionId: parsed.data.id, reason: "ended_by_user", by: userId });
      if (!ended) return NextResponse.json({ error: "That session has already ended." }, { status: 404 });
      await Promise.all([
        recordSecurityEvent({ userId, tenantId, type: "session_ended", detail: { sessionId: parsed.data.id }, request }),
        audit({ actorType: "tenant", actorId: userId, action: "user.own_sessions_ended", targetType: "user", targetId: userId, metadata: { tenantId, scope: "one", sessionId: parsed.data.id }, request }),
      ]);
      return NextResponse.json({ ok: true, ended });
    }
    const { token, ended } = await endOtherSessions(auth.context, "ended_by_user", request);
    await Promise.all([
      recordSecurityEvent({ userId, tenantId, type: "other_sessions_ended", detail: { ended }, request }),
      audit({ actorType: "tenant", actorId: userId, action: "user.own_sessions_ended", targetType: "user", targetId: userId, metadata: { tenantId, scope: "other_sessions", ended }, request }),
    ]);
    const response = NextResponse.json({ ok: true, ended });
    response.cookies.set(TENANT_SESSION_COOKIE, token, tenantSessionCookieOptions);
    return response;
  } catch (error) {
    if (error instanceof AccountSecurityError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[profile/sessions]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The session could not be ended. Try again." }, { status: 500 });
  }
}
