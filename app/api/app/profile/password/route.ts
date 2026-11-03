import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { TENANT_SESSION_COOKIE } from "@/lib/tenantAuth/session";
import { PASSWORD_MAX } from "@/lib/tenantAuth/securityRules";
import { AccountSecurityError, changePassword } from "@/lib/users/accountSecurity";

/**
 * LA-8.2 · change my password. The current password is required; the new one needs length, not
 * symbols. Every other session ends, this one continues, and the person is emailed. Every role.
 */
const bodySchema = z.object({ current: z.string().min(1).max(PASSWORD_MAX), next: z.string().min(1).max(PASSWORD_MAX + 1) }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your current password and a new one." }, { status: 400 });
  try {
    const { token, ended, cookie } = await changePassword(auth.context, parsed.data.current, parsed.data.next, request);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "user.password_changed", targetType: "user", targetId: auth.context.userId, metadata: { tenantId: auth.context.tenantId, otherSessionsEnded: ended }, request });
    const response = NextResponse.json({ ok: true, otherSessionsEnded: ended });
    response.cookies.set(TENANT_SESSION_COOKIE, token, cookie);
    return response;
  } catch (error) {
    if (error instanceof AccountSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined });
    }
    console.error("[profile/password]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Your password could not be changed. Nothing changed." }, { status: 500 });
  }
}
