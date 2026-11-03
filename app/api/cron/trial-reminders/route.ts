import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { sendDueTrialReminders } from "@/lib/trials/sendDueReminders";

/**
 * SA-5.3 · The scheduled trial reminders (daily; pg_cron calls it through call_app_cron,
 * 20261015500000). The same code as `npm run trials:remind`, and idempotent the same way: every
 * reminder is recorded on (subscription, kind, trial_ends_at), so a retry or an overlapping run
 * sends nothing twice.
 *
 * Same shape as /api/cron/period-billing. Fails closed: with no CRON_SECRET set this answers 401
 * to everybody, including the scheduler.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const run = await sendDueTrialReminders(getSupabaseServiceClient());
    // Per-reminder failures are left unrecorded for the next run; say so with a non-2xx so the
    // dispatcher's status shows it.
    return NextResponse.json(run, { status: run.errors.length ? 503 : 200 });
  } catch (error) {
    console.error("[cron/trial-reminders]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trial reminders failed" }, { status: 500 });
  }
}
