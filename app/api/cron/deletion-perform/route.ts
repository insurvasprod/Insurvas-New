import { NextResponse } from "next/server";

import { performDueDeletions } from "@/lib/compliance/dataSubjectStore";

/**
 * LA-6.5 · hourly: perform every verified consumer deletion whose cancellable hold has ended. A
 * deletion request carries a legal clock, so it is not left waiting for someone to press the button.
 * The purge itself is SQL (data_subject_purge_group) but the complaint files live in storage, so the
 * app runs it. Like the other /api/cron routes it needs a scheduler and the CRON_SECRET bearer.
 * A request that fails stays open with the failure in its events, and is retried next run; the
 * response is 500 when any failed, so the scheduler's status shows it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await performDueDeletions();
    if (result.failed.length) console.error("[cron/deletion-perform] some deletions failed", result.failed);
    return NextResponse.json({ ok: !result.failed.length, performed: result.performed.length, failed: result.failed.map((f) => f.id) }, { status: result.failed.length ? 500 : 200 });
  } catch (error) {
    console.error("[cron/deletion-perform]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "failed" }, { status: 500 });
  }
}
