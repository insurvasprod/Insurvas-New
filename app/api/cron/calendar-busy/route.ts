import { NextResponse } from "next/server";

import { syncAllCalendars } from "@/lib/appointments/linkedCalendars";

/**
 * Keeps linked-calendar busy time current (20260924230200). Each pass refreshes the least recently
 * synced calendars; a failure marks that connection "error" and leaves its last busy set standing.
 * Before any calendar is linked — or before the migration — it does nothing and says so.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await syncAllCalendars();
    return NextResponse.json(report, { status: report.failed > 0 ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Linked calendars could not be synced." }, { status: 503 });
  }
}
