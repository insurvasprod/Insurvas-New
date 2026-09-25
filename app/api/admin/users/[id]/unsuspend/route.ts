import type { NextRequest } from "next/server";

import { setUserStatus } from "@/lib/users/setStatus";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Unsuspending returns the user to active — the state they were blocked out of.
  //
  // Only from `suspended`. This route and /activate both target `active`, so the database's
  // transition rules cannot distinguish them; without the guard, unsuspending a user who was
  // never suspended succeeded and activated an invited account that had never set a password.
  return setUserStatus(request, id, "active", "user.unsuspended", undefined, {
    requireCurrentStatus: ["suspended"],
    actionLabel: "unsuspended",
  });
}
