import type { NextRequest } from "next/server";

import { setUserStatus } from "@/lib/users/setStatus";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return setUserStatus(request, id, "active", "user.activated");
}
