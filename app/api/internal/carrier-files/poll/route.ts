import { NextResponse, type NextRequest } from "next/server";

import { rederiveBucketChanges } from "@/lib/ingestion/bucketStore";
import { runPending } from "@/lib/ingestion/dailyRunStore";
import { checkPollBearer } from "@/lib/ingestion/doorAuth";
import { parsePendingFiles } from "@/lib/ingestion/parser";
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
    // LA-4.19: one orchestrated run per agency with waiting files — collect, ingest, parse, store,
    // match, reconcile, analyse — each stage recorded, a stopped file resumed. Replaced files still
    // get their raw rows below. Before 20261008280000 the earlier sweeps run instead.
    const run = await runPending("file_arrival");
    if (run.available) {
      const raw = await extractPendingRawRows(20);
      // A scheduled check marks files removed in the database; reading them again needs the app.
      const rederived = await rederiveBucketChanges(null, 10).catch((error) => { console.error("[carrier-files/poll] re-reading removed files failed:", error); return null; });
      return NextResponse.json({ ok: true, runs: run.runs.map((r) => ({ status: r.status, files: r.total, succeeded: r.succeeded, failed: r.failed, left: r.leftForNextRun })), raw: { ...raw, errors: raw.errors.length }, rederived });
    }
    const outcome = await pollBucketDrops(100);
    if (outcome.errors.length) console.error(`[carrier-files/poll] ${outcome.errors.length} drop(s) failed:`, outcome.errors.slice(0, 5));
    // LA-4.2: then every spreadsheet still waiting for its raw rows, from any door.
    const raw = await extractPendingRawRows(20);
    if (raw.errors.length) console.error(`[carrier-files/poll] ${raw.errors.length} raw extraction(s) failed:`, raw.errors.slice(0, 5));
    // LA-4.3: then parse every sealed file not yet read, and retry those waiting for a layout map.
    const parsed = await parsePendingFiles(20);
    if (parsed.errors.length) console.error(`[carrier-files/poll] ${parsed.errors.length} parse(s) failed:`, parsed.errors.slice(0, 5));
    return NextResponse.json({ ok: true, ...outcome, registeredFiles: undefined, errors: outcome.errors.length, raw: { ...raw, errors: raw.errors.length }, parsed: { ...parsed, errors: parsed.errors.length } });
  } catch (error) {
    console.error("[carrier-files/poll] failed:", error);
    return NextResponse.json({ error: "The poll failed" }, { status: 500 });
  }
}
