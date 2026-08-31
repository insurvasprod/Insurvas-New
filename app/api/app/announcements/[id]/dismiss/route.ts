import { NextResponse } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { dismissAnnouncement } from "@/lib/system/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await dismissAnnouncement(id, auth.context.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not dismiss announcement" }, { status: 400 });
  }
}
