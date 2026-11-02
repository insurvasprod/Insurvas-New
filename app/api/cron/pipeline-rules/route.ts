import { NextResponse } from "next/server";

import { runAllAgencies } from "@/lib/pipelineRules/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Setup › Pipeline rules · the morning date check (owner 2026-11-02): a payment missed past the carrier's
 * grace is an event even when no file arrives, so every agency with a rule on (forecast or live) is
 * evaluated once a day. Scheduled by pg_cron through the app's dispatcher (20261102100000 adds this path
 * to app_cron_paths); any scheduler holding CRON_SECRET may call it. Running it twice records nothing
 * twice: each change is recorded once per rule, version and mode.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const outcome = await runAllAgencies("daily");
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[cron/pipeline-rules] failed:", error);
    return NextResponse.json({ error: "The pipeline rules run failed" }, { status: 500 });
  }
}
