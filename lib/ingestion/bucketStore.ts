import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { bucketRows, type BucketFile, type BucketRow, type MissingFile } from "./bucket";
import { agencyTimezone } from "./agencyDay";
import { runPending } from "./dailyRunStore";
import { libraryCarriers } from "./registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/**
 * Carrier files › Bucket: LA-4.1's automated drop, one day at a time — the files the agency's
 * scripts dropped, as they were read — and the file monitor's missing-file findings (LA-4.19),
 * judged from each carrier's cadence in Carrier rules (LA-4.17). Reading writes nothing.
 *
 * "Check now" is a run by hand (the LA-4.19 manual trigger): whatever is waiting is registered and
 * walked through every stage now, instead of at the next five-minute poll. Deleting a file from
 * the bucket changes nothing: once registered, a file and its rows are permanent (LA-4.1, 4.2).
 */

export const BUCKET_PENDING_MESSAGE = "The bucket page needs a database update (20261009100000).";

export type BucketView =
  | { available: false }
  | { available: true; date: string; timezone: string; rows: BucketRow[]; missing: MissingFile[] };

export { agencyTimezone } from "./agencyDay";


/** One day of the bucket, for the page (and its 20-second refresh). */
export async function loadBucketView(tenantId: string, date: string): Promise<BucketView> {
  const [timezone, files, findings, carriers] = await Promise.all([
    agencyTimezone(tenantId),
    db().from("file_registry").select("id, path_agency, carrier_id, file_type, file_date, original_filename, file_bytes, received_at, status, error_detail, raw_error, superseded_by_file_id, row_count, storage_path")
      .eq("tenant_id", tenantId).eq("source", "bucket").eq("file_date", date).order("received_at", { ascending: false }).limit(1000),
    db().from("agent_findings").select("id, payload, reasoning, created_at").eq("tenant_id", tenantId).eq("agent_name", "file_monitor").eq("finding_type", "missing_file").eq("status", "open").order("created_at", { ascending: false }).limit(200),
    libraryCarriers(),
  ]);
  for (const result of [files, findings]) {
    if (result.error) {
      if (isSchemaGap(result.error)) return { available: false };
      throw new Error(`Could not load the bucket: ${result.error.message}`);
    }
  }
  const carrierName = new Map(carriers.map((carrier) => [carrier.id, carrier.name]));
  const fileRows: BucketFile[] = ((files.data ?? []) as Loose[]).map((row) => ({
    id: row.id, agency: row.path_agency, carrierId: row.carrier_id, carrierName: row.carrier_id ? carrierName.get(row.carrier_id) ?? "Carrier not known" : null,
    fileType: row.file_type, fileDate: row.file_date, filename: row.original_filename, bytes: Number(row.file_bytes ?? 0), receivedAt: row.received_at,
    status: row.status, problem: row.error_detail ?? row.raw_error ?? null, replaced: row.superseded_by_file_id !== null, rows: row.row_count, path: row.storage_path,
  }));
  const missing: MissingFile[] = ((findings.data ?? []) as Loose[]).map((row) => ({
    id: row.id, carrierId: row.payload?.carrier_id, carrierName: carrierName.get(row.payload?.carrier_id) ?? "Carrier not known", cadence: row.payload?.cadence ?? "",
    due: row.payload?.due ?? "", lastReceivedAt: row.payload?.last_received_at ?? null, reasoning: row.reasoning,
  }));
  return { available: true, date, timezone, rows: bucketRows(fileRows), missing };
}

/** Check now: a run by hand over whatever is waiting for the agency. Returns how many files it took. */
export async function checkBucketNow(tenantId: string): Promise<{ registered: number }> {
  const outcome = await runPending("manual", { tenantId });
  return { registered: outcome.runs.find((run) => run.tenantId === tenantId)?.total ?? 0 };
}
