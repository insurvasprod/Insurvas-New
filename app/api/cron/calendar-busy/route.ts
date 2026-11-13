import { NextResponse } from "next/server";

import { syncAllCalendars } from "@/lib/appointments/linkedCalendars";
import { mirrorRecentlyChanged, pullMeetingLengths } from "@/lib/appointments/calendarMirror";

/** The pass runs every 15 minutes; 20 minutes back overlaps the last run, and writing twice is harmless. */
const MIRROR_LOOKBACK_MS = 20 * 60_000;

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
    // Lengths changed in Google first, so the push below writes the new length rather than the old one.
    const lengths = await pullMeetingLengths().catch((error) => ({ changed: 0, failed: 1, error: error instanceof Error ? error.message : "failed" }));
    // Meetings changed by any screen (close-out, the vault, a reschedule) reach linked Google calendars.
    const mirror = await mirrorRecentlyChanged(new Date(Date.now() - MIRROR_LOOKBACK_MS).toISOString()).catch((error) => ({
      error: error instanceof Error ? error.message : "The meeting copy could not run.",
    }));
    const mirrorFailed = "error" in mirror || mirror.failed > 0;
    return NextResponse.json({ ...report, lengths, mirror }, { status: report.failed > 0 || mirrorFailed || lengths.failed > 0 ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Linked calendars could not be synced." }, { status: 503 });
  }
}
