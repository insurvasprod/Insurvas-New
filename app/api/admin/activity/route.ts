import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { fetchLoginActivityPage, ACTIVITY_PAGE_SIZE } from "@/lib/loginEvents/queries";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const rawOutcome = params.get("outcome");
  const outcome = rawOutcome === "success" || rawOutcome === "failure" ? rawOutcome : undefined;

  try {
    const { events, total } = await fetchLoginActivityPage({ page, outcome });
    return NextResponse.json({ events, total, page, pageSize: ACTIVITY_PAGE_SIZE });
  } catch {
    return NextResponse.json({ error: "Could not load login activity" }, { status: 500 });
  }
}
