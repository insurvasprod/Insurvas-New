import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_USERS } from "@/lib/users/permissions";
import { fetchUserStats } from "@/lib/users/list";

export async function GET() {
  const auth = await requireAdminRole(CAN_VIEW_USERS);
  if (auth instanceof NextResponse) return auth;

  try {
    const stats = await fetchUserStats();
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json({ error: "Could not load user stats" }, { status: 500 });
  }
}
