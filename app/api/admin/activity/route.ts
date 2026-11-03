import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { fetchLoginActivityPage, ACTIVITY_PAGE_SIZE } from "@/lib/loginEvents/queries";
import { parseActivityFilters, staffLoginsVisibleTo } from "@/lib/loginEvents/present";

/**
 * GET /api/admin/activity?page&outcome&actor&range&q — one page of the platform-wide login feed.
 * Read-only, so no audit row. Unrecognised filter values fall back to the defaults.
 *
 * Staff sign-ins (emails + IPs of platform admins) are in the feed for super_admin only; support
 * and billing get tenant-user sign-ins, whatever `actor` they ask for.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const page = Math.min(10_000, Math.max(1, Math.floor(Number(params.get("page"))) || 1));
  const filters = parseActivityFilters(params);

  try {
    const { events, total, rangeTotal } = await fetchLoginActivityPage({
      page,
      filters,
      includeStaff: staffLoginsVisibleTo(auth.session.role),
    });
    return NextResponse.json(
      { events, total, rangeTotal, page, pageSize: ACTIVITY_PAGE_SIZE },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not load login activity" }, { status: 500 });
  }
}
