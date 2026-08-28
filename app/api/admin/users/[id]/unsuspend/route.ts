import type { NextRequest } from "next/server";

import { setUserStatus } from "@/lib/users/setStatus";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Unsuspending returns the user to active — the state they were blocked out of.
  return setUserStatus(request, id, "active", "user.unsuspended");
}
