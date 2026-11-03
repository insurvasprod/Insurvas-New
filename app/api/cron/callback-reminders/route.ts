import { NextResponse } from "next/server";

import { processCallbackReminders } from "@/lib/callbacks/reminders";

/**
 * The EMAIL half of callback reminders, for the scheduler (vercel.json, every five minutes). The
 * in-app half already runs in the database on pg_cron (run_callback_in_app_reminders,
 * 20260925708700) and writes the same agent_notifications source_key this job upserts, so whichever
 * runs first the agent sees one reminder.
 *
 * Inactive until the app has a host: nothing calls this URL before then. The older POST route,
 * /api/internal/callback-reminders (CALLBACK_REMINDER_SECRET, `npm run callbacks:remind`), still
 * works for a manual run.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await processCallbackReminders());
  } catch (error) {
    console.error("Callback reminder job failed", error);
    return NextResponse.json({ error: "Callback reminders could not be processed." }, { status: 503 });
  }
}
