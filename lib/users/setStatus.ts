import "server-only";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_SET_USER_STATUS } from "@/lib/users/permissions";
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
  options?: {
    /**
     * States this transition may start from. Without it, any legal transition to `target` is
     * allowed — which is right for activate and deactivate, and wrong for unsuspend.
     *
     * `unsuspend` and `activate` both target `active`, so the database transition rules cannot
     * tell them apart. The effect was that POST /unsuspend on a user who had never been suspended
     * returned 200 and moved them `pending_verification -> active`: an invited account that had
     * never set a password was marked active by a route named for undoing a suspension, and then
     * counted as a consumed seat.
     */
    requireCurrentStatus?: readonly string[];
    /** Human name for the current-state error, e.g. "unsuspended". */
    actionLabel?: string;
  },
): Promise<NextResponse> {
  const auth = await requireAdminRole(CAN_SET_USER_STATUS);
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
  if (options?.requireCurrentStatus && !options.requireCurrentStatus.includes(user.status)) {
    // Name the state rather than saying "not allowed". The generic message the database raises
    // ("that user cannot move to this state from their current state") tells the admin neither
    // where the user is nor what would work.
    return NextResponse.json(
      {
        error: `Only a ${options.requireCurrentStatus.join(" or ")} user can be ${options.actionLabel ?? target}. This user is ${user.status}.`,
      },
      { status: 409 },
    );
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
    // The one seat rule (migration 20260924346000) applies the buffer and setter sub-limits to a
    // reactivation too, in the same `<key>:<used>:<max>` shape.
    const subLimit = /(max_buffer_seats|max_setter_seats):(\d+):(\d+)/i.exec(error.message ?? "");
    if (subLimit) {
      const [, key, used, max] = subLimit;
      const what = key.toLowerCase() === "max_buffer_seats" ? "assistant (buffer) seats" : "setter seats";
      return NextResponse.json({ error: `This tenant is using all ${max} ${what} (${used} in use). Upgrade the plan or deactivate another user.` }, { status: 409 });
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
