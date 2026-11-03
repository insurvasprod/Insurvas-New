import type { NextRequest } from "next/server";

import { setUserStatus } from "@/lib/users/setStatus";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Reactivating returns a deactivated user to active — the state they were moved out of.
  //
  // Only from `inactive`. The database allows pending_verification -> active, so without this guard
  // an invited user who had never set a password was marked active (and took a seat) by a route
  // meant for undoing a deactivation. An invitee becomes active by accepting the invitation; a
  // suspended user comes back through /unsuspend, which has the same guard.
  return setUserStatus(request, id, "active", "user.activated", undefined, {
    requireCurrentStatus: ["inactive"],
    actionLabel: "reactivated",
  });
}
