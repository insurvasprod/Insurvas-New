import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";

type TargetStatus = "active" | "inactive" | "suspended";

/**
 * Shared implementation for activate / deactivate / suspend / unsuspend.
 *
 * All four are the same operation with different labels, so the transition rules — and the
 * invariant that suspended_at/suspension_reason are set together with the status — live here
 * rather than being re-implemented (and drifted) across four routes.
 *
 * Note there is no session-invalidation step: `resolveTenantContext()` reads the live status on
 * every request, so anything other than 'active' drops the user on their next request. That is
 * what satisfies SA-1.4's "logged out on their next request, not at session expiry".
 */
export async function setUserStatus(
  request: NextRequest,
  userId: string,
  target: TargetStatus,
  action: AuditAction,
  reason?: string,
): Promise<NextResponse> {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const supabase = getSupabaseServiceClient();

  const { data: user } = await supabase
    .from("users")
    .select("id, email, status")
    .eq("id", userId)
    .maybeSingle<{ id: string; email: string; status: string }>();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.status === "deleted") {
    return NextResponse.json({ error: "This user has been removed" }, { status: 409 });
  }
  if (user.status === target) {
    return NextResponse.json({ error: `This user is already ${target}` }, { status: 409 });
  }

  const { error } = await supabase
    .from("users")
    .update({
      status: target,
      // The CHECK constraint requires these to move together with the status.
      suspended_at: target === "suspended" ? new Date().toISOString() : null,
      suspension_reason: target === "suspended" ? (reason ?? null) : null,
    })
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: "Could not update this user's state" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action,
    targetType: "user",
    targetId: userId,
    reason: reason ?? undefined,
    metadata: { email: user.email, status: { from: user.status, to: target } },
    request,
  });

  return NextResponse.json({ ok: true, status: target });
}
