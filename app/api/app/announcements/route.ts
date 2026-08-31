import { NextResponse } from "next/server";

import { getActiveAnnouncements, getMaintenanceStatus } from "@/lib/system/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") {
    return NextResponse.json({ error: maintenance.message ?? "The platform is temporarily unavailable.", code: "maintenance_locked" }, { status: 503 });
  }

  try {
    return NextResponse.json({ announcements: await getActiveAnnouncements(auth.context.userId, auth.context.tenantId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load announcements" }, { status: 500 });
  }
}
