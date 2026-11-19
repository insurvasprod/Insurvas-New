import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { fetchAttemptDetail } from "@/lib/loginEvents/queries";
import { staffLoginsVisibleTo } from "@/lib/loginEvents/present";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/activity/[id] — one sign-in attempt for Login activity's sheet (admin round 1, monitoring.html
 * screen 2): the attempt, what else came from its address and on its account in the 24 hours before it, and the
 * customer's workspace name. Same gate as the feed (CAN_VIEW_USERS); a staff sign-in is a 404 for a role that may
 * not see staff sign-ins, the same answer as a missing row. Read-only, so no audit row.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

  try {
    const detail = await fetchAttemptDetail(id, staffLoginsVisibleTo(auth.session.role));
    if (!detail) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the attempt" }, { status: 500 });
  }
}
