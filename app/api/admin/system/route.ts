import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SETTINGS } from "@/lib/settings/permissions";
import { listAnnouncements } from "@/lib/system/service";
import { getMaintenanceStatus } from "@/lib/system/service";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_SETTINGS);
  if (auth instanceof NextResponse) return auth;

  try {
    const [maintenance, announcements] = await Promise.all([getMaintenanceStatus(), listAnnouncements()]);
    return NextResponse.json({ maintenance, announcements });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load system settings" }, { status: 500 });
  }
}
