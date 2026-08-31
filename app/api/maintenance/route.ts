import { NextResponse } from "next/server";

import { getMaintenanceStatus } from "@/lib/system/service";

/** Public, message-only status used by the tenant login screen. No credentials or admin data. */
export async function GET() {
  const status = await getMaintenanceStatus();
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
