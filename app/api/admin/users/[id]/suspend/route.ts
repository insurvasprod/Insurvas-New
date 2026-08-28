import { NextResponse, type NextRequest } from "next/server";

import { setUserStatus } from "@/lib/users/setStatus";
import { suspendUserSchema } from "@/lib/users/schemas";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = suspendUserSchema.safeParse(body);
  if (!parsed.success) {
    // The reason is mandatory (SA-1.4) — enforced here, not just in the UI.
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "A reason is required" }, { status: 400 });
  }

  return setUserStatus(request, id, "suspended", "user.suspended", parsed.data.reason);
}
