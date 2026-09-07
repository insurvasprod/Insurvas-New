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

  const { data, error } = await supabase.rpc("admin_set_user_status", {
    p_user_id: userId,
    p_status: target,
    p_reason: reason ?? null,
  });

  if (error) {
    if (/USER_ALREADY_IN_STATE|USER_TRANSITION_NOT_ALLOWED/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "That user cannot move to this state from their current state" }, { status: 409 });
    }
    if (/seat_limit_reached:(\d+):(\d+)/i.test(error.message ?? "")) {
      const [, used, max] = /seat_limit_reached:(\d+):(\d+)/i.exec(error.message ?? "")!;
      return NextResponse.json({ error: `This tenant is using all ${max} seats (${used} in use). Upgrade the plan or deactivate another user.` }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update this user's state" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "Could not update this user's state" }, { status: 500 });

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
