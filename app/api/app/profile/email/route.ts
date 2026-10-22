import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { AccountSecurityError, requestEmailChange } from "@/lib/users/accountSecurity";

/**
 * LA-8.2 · ask to change my sign-in email. Nothing changes until the link sent to the new address
 * is used (POST /api/app/auth/confirm-email); the old address is told now. The current password is
 * required: a session left open on a shared machine must not be enough to move the login. Every role.
 */
const bodySchema = z.object({ newEmail: z.string().trim().toLowerCase().email("Enter a valid email address").max(254), currentPassword: z.string().min(1).max(200) }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter the new address and your current password." }, { status: 400 });
  try {
    const result = await requestEmailChange(auth.context, parsed.data.newEmail, parsed.data.currentPassword, request);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "user.email_change_requested", targetType: "user", targetId: auth.context.userId, metadata: { tenantId: auth.context.tenantId, selfService: true, to: result.newEmail }, request });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AccountSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined });
    }
    console.error("[profile/email]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The change could not be started. Nothing changed." }, { status: 500 });
  }
}
