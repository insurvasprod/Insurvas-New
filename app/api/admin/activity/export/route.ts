import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { EXPORT_CAP, fetchLoginActivityExport } from "@/lib/loginEvents/queries";
import { loginEventsCsv, parseActivityFilters, parseActivityLens, staffLoginsVisibleTo } from "@/lib/loginEvents/present";

/**
 * GET /api/admin/activity/export?outcome&actor&range&q&lens — Login activity's Export CSV (admin round 1,
 * monitoring.html screen 2): the attempts the filters on screen match, newest first, at most EXPORT_CAP rows (a
 * capped file says so in its name). Same gate and staff rule as the feed (GET /api/admin/activity). Read-only, like
 * the feed, so no audit row.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const filters = parseActivityFilters(params);
  const lens = parseActivityLens(params);

  try {
    const { events, capped } = await fetchLoginActivityExport({ filters, lens, includeStaff: staffLoginsVisibleTo(auth.session.role) });
    const day = new Date().toISOString().slice(0, 10);
    const name = `login-activity-${filters.range}-${day}${capped ? `-first-${EXPORT_CAP}` : ""}.csv`;
    return new NextResponse(loginEventsCsv(events), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not export login activity" }, { status: 500 });
  }
}
