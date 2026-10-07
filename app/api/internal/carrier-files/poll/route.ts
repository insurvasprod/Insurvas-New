import { NextResponse, type NextRequest } from "next/server";

import { checkPollBearer } from "@/lib/ingestion/doorAuth";
import { extractPendingRawRows } from "@/lib/ingestion/rawLayer";
import { pollBucketDrops } from "@/lib/ingestion/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * LA-4.1 (Notion sprint) · the bucket door's poll: registers what agencies' scripts dropped into
 * carrier-files/<tenant>/inbox/<date>/<agency>/<carrier>/<Policies|Commissions>/<file> since the
 * last run. Called every five minutes by pg_cron through pg_net (migration 20261008100000), or by
 * any scheduler holding CARRIER_FILES_POLL_SECRET. Running it twice registers nothing twice.
 */
export async function POST(request: NextRequest) {
  const auth = checkPollBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    if (auth.status === 500) console.error(`[carrier-files/poll] ${auth.reason}`);
    return NextResponse.json({ error: auth.status === 500 ? "Poll not configured" : "Unauthorized" }, { status: auth.status });
  }
  try {
    const outcome = await pollBucketDrops(100);
    if (outcome.errors.length) console.error(`[carrier-files/poll] ${outcome.errors.length} drop(s) failed:`, outcome.errors.slice(0, 5));
    // LA-4.2: then every spreadsheet still waiting for its raw rows, from any door.
    const raw = await extractPendingRawRows(20);
    if (raw.errors.length) console.error(`[carrier-files/poll] ${raw.errors.length} raw extraction(s) failed:`, raw.errors.slice(0, 5));
    return NextResponse.json({ ok: true, ...outcome, errors: outcome.errors.length, raw: { ...raw, errors: raw.errors.length } });
  } catch (error) {
    console.error("[carrier-files/poll] failed:", error);
    return NextResponse.json({ error: "The poll failed" }, { status: 500 });
  }
}
