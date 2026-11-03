import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { setUserStatus } from "@/lib/users/setStatus";
import { suspendUserSchema } from "@/lib/users/schemas";
import { CAN_SET_USER_STATUS } from "@/lib/users/permissions";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Authenticate before reading the body. This route used to validate first, so an unauthenticated
  // caller got 400 "A reason is required" where every sibling route answers 401 — telling a
  // stranger about the route's input contract, and making the one route on the admin surface that
  // does not refuse an anonymous request outright. setUserStatus checks again; that is deliberate.
  const auth = await requireAdminRole(CAN_SET_USER_STATUS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = suspendUserSchema.safeParse(body);
  if (!parsed.success) {
    // The reason is mandatory (SA-1.4) — enforced here, not just in the UI.
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, { status: 400 });
  }

  return setUserStatus(request, id, "suspended", "user.suspended", parsed.data.reason);
}
