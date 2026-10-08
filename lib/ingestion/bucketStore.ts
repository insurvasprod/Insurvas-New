import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { bucketDay, type BucketDay, type BucketExpectation, type BucketFile } from "./bucket";
import { FILE_TYPES, type CarrierFileType } from "./constants";
import { runPending } from "./dailyRunStore";
import { libraryCarriers } from "./registry";
import { reprocessCarrierFiles } from "./reprocessRuns";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/**
 * Carrier files › Bucket (2026-10-09): the files an agency's scripts drop into the bucket, one day at
 * a time — which were expected, which arrived, which are missing, which nobody expected — with its
 * checks (scheduled, by hand, and the 5-minute poll) and the settings behind them.
 *
 * Reading writes nothing. "Check now" syncs files removed from the bucket, runs the pipeline over
 * whatever arrived (collect → … → analyse), and records the check. Settings are the agency's own.
 */

export const BUCKET_PENDING_MESSAGE = "The bucket page needs a database update (20261009100000).";

export type BucketSettings = { checkTimes: string[]; timezone: string; updatedAt: string | null };
export type BucketCheck = { checkedAt: string; trigger: "schedule" | "manual" | "poll"; checkedByName: string | null; registered: number; removed: number; restored: number };

export type BucketView =
  | { available: false }
  | { available: true; day: BucketDay; settings: BucketSettings; checks: BucketCheck[]; carriers: Array<{ id: string; name: string }>; agencies: string[]; expectations: BucketExpectation[] };

const DEFAULT_SETTINGS: BucketSettings = { checkTimes: ["10:00", "16:00"], timezone: "America/New_York", updatedAt: null };

/** "HH:MM" from Postgres' "HH:MM:SS". */
const hhmm = (value: string) => value.slice(0, 5);

export async function loadBucketSettings(tenantId: string): Promise<BucketSettings | null> {
  const { data, error } = await db().from("carrier_bucket_settings").select("check_times, timezone, updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not load the bucket settings: ${error.message}`);
  }
  return data ? { checkTimes: ((data.check_times ?? []) as string[]).map(hhmm).sort(), timezone: data.timezone, updatedAt: data.updated_at } : DEFAULT_SETTINGS;
}

/** One day of the bucket, for the page (and its 20-second refresh). */
export async function loadBucketView(tenantId: string, date: string): Promise<BucketView> {
  const settings = await loadBucketSettings(tenantId);
  if (!settings) return { available: false };
  const [expectations, files, checks, carriers, agencyRows] = await Promise.all([
    db().from("carrier_file_expectation").select("id, path_agency, carrier_id, file_type, weekdays, active").eq("tenant_id", tenantId),
    db().from("file_registry").select("id, path_agency, carrier_id, file_type, file_date, original_filename, file_bytes, received_at, status, error_detail, raw_error, removed_from_bucket_at, restored_at, superseded_by_file_id, row_count, storage_path")
      .eq("tenant_id", tenantId).eq("source", "bucket").eq("file_date", date).order("received_at", { ascending: false }).limit(1000),
    db().from("carrier_bucket_check").select("checked_at, trigger, checked_by, registered, removed, restored").eq("tenant_id", tenantId).eq("check_date", date).order("checked_at", { ascending: false }).limit(50),
    libraryCarriers(),
    // Every agency folder seen, so the settings can offer them.
    db().from("file_registry").select("path_agency").eq("tenant_id", tenantId).eq("source", "bucket").not("path_agency", "is", null).order("received_at", { ascending: false }).limit(2000),
  ]);
  for (const result of [expectations, files, checks, agencyRows]) {
    if (result.error) {
      if (isSchemaGap(result.error)) return { available: false };
      throw new Error(`Could not load the bucket: ${result.error.message}`);
    }
  }
  const carrierName = new Map(carriers.map((carrier) => [carrier.id, carrier.name]));
  const checkerIds = [...new Set(((checks.data ?? []) as Loose[]).map((check) => check.checked_by).filter(Boolean))] as string[];
  const users = checkerIds.length ? ((await db().from("users").select("id, name, email").in("id", checkerIds)).data ?? []) as Loose[] : [];
  const userName = new Map(users.map((user) => [user.id, user.name || user.email || "A teammate"]));

  const expectationRows: BucketExpectation[] = ((expectations.data ?? []) as Loose[]).map((row) => ({
    id: row.id, agency: row.path_agency, carrierId: row.carrier_id, carrierName: carrierName.get(row.carrier_id) ?? "Carrier not known",
    fileType: row.file_type as CarrierFileType, weekdays: (row.weekdays ?? []).map(Number), active: row.active,
  }));
  const fileRows: BucketFile[] = ((files.data ?? []) as Loose[]).map((row) => ({
    id: row.id, agency: row.path_agency, carrierId: row.carrier_id, carrierName: row.carrier_id ? carrierName.get(row.carrier_id) ?? "Carrier not known" : null,
    fileType: row.file_type, fileDate: row.file_date, filename: row.original_filename, bytes: Number(row.file_bytes ?? 0), receivedAt: row.received_at,
    status: row.status, problem: row.error_detail ?? row.raw_error ?? null, removedAt: row.removed_from_bucket_at, restoredAt: row.restored_at,
    replaced: row.superseded_by_file_id !== null, rows: row.row_count, path: row.storage_path,
  }));
  const agencies = [...new Set([...((agencyRows.data ?? []) as Loose[]).map((row) => row.path_agency as string), ...expectationRows.map((row) => row.agency)])].sort((a, b) => a.localeCompare(b));

  return {
    available: true,
    day: bucketDay({ date, timezone: settings.timezone, expectations: expectationRows, files: fileRows }),
    settings,
    checks: ((checks.data ?? []) as Loose[]).map((row) => ({ checkedAt: row.checked_at, trigger: row.trigger, checkedByName: row.checked_by ? userName.get(row.checked_by) ?? "A teammate" : null, registered: row.registered, removed: row.removed, restored: row.restored })),
    carriers: carriers.map((carrier) => ({ id: carrier.id, name: carrier.name })),
    agencies,
    expectations: [...expectationRows].sort((a, b) => a.agency.localeCompare(b.agency) || a.carrierName.localeCompare(b.carrierName) || a.fileType.localeCompare(b.fileType)),
  };
}

export class BucketError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Check now: files removed from the bucket (or back), then one run over whatever arrived, then the
 * check recorded for the agency's day. Returns what moved.
 */
export async function checkBucketNow(tenantId: string, userId: string, date: string): Promise<{ registered: number; removed: number; restored: number }> {
  const { data: sync, error } = await db().rpc("sync_carrier_bucket_removals", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error)) throw new BucketError(BUCKET_PENDING_MESSAGE, 503);
    throw new Error(`Could not check the bucket for removed files: ${error.message}`);
  }
  const removed = ((sync?.removed ?? []) as string[]).length;
  const restored = ((sync?.restored ?? []) as string[]).length;
  const outcome = await runPending("manual", { tenantId });
  const registered = outcome.runs.find((run) => run.tenantId === tenantId)?.total ?? 0;
  // A removed file stops counting, a restored one counts again: each is read again from its raw rows.
  await rederiveBucketChanges(tenantId);
  const { error: logError } = await db().from("carrier_bucket_check").insert({ tenant_id: tenantId, check_date: date, trigger: "manual", checked_by: userId, registered, removed, restored });
  if (logError) throw new Error(`The check ran but could not be recorded: ${logError.message}`);
  return { registered, removed, restored };
}

/**
 * The bucket files whose removal changed since they were last derived (20261009150000), read again
 * from their raw rows: a removed file's snapshots stop counting and its lines are reversed; a
 * restored one counts again. Check now runs it for its agency at once; the poll for everyone.
 */
export async function rederiveBucketChanges(tenantId: string | null, limit = 20): Promise<{ available: boolean; files: number; failed: number }> {
  const { data, error } = await db().rpc("bucket_files_to_rederive", { p_tenant_id: tenantId, p_limit: limit });
  if (error) {
    if (isSchemaGap(error)) return { available: false, files: 0, failed: 0 };
    throw new Error(`Could not list the files removed from the bucket: ${error.message}`);
  }
  let failed = 0;
  const files = (data ?? []) as Array<{ tenant_id: string; file_id: string }>;
  for (const file of files) {
    const run = await reprocessCarrierFiles(file.tenant_id, null, { kind: "file", fileId: file.file_id }, "bucket_removal").catch((failure) => {
      console.error(`[bucket] ${file.file_id} could not be read again after its removal changed; the poll retries:`, failure);
      return null;
    });
    if (run?.status !== "succeeded") failed++;
  }
  return { available: true, files: files.length, failed };
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveBucketSettings(tenantId: string, userId: string, input: { checkTimes: string[]; timezone: string }): Promise<void> {
  const times = [...new Set(input.checkTimes)].sort();
  if (times.some((time) => !TIME.test(time))) throw new BucketError("Enter each check time as HH:MM, like 10:00.");
  if (times.length > 24) throw new BucketError("At most 24 check times a day.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    throw new BucketError("Choose a time zone from the list.");
  }
  const { error } = await db().from("carrier_bucket_settings").upsert({ tenant_id: tenantId, check_times: times, timezone: input.timezone, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) {
    if (isSchemaGap(error)) throw new BucketError(BUCKET_PENDING_MESSAGE, 503);
    throw new Error(`Could not save the bucket settings: ${error.message}`);
  }
}

export type ExpectationInput = { agency: string; carrierId: string; fileType: string; weekdays: number[]; active: boolean };

function checkExpectation(input: ExpectationInput): ExpectationInput {
  const agency = input.agency.trim();
  if (!agency || agency.length > 120) throw new BucketError("Enter the agency folder name, as it is in the bucket.");
  if (!(FILE_TYPES as readonly string[]).includes(input.fileType)) throw new BucketError("Choose the file type.");
  const weekdays = [...new Set(input.weekdays)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
  if (!weekdays.length) throw new BucketError("Choose at least one day of the week.");
  return { ...input, agency, weekdays };
}

export async function addExpectation(tenantId: string, userId: string, input: ExpectationInput): Promise<void> {
  const value = checkExpectation(input);
  const { error } = await db().from("carrier_file_expectation").insert({ tenant_id: tenantId, path_agency: value.agency, carrier_id: value.carrierId, file_type: value.fileType, weekdays: value.weekdays, active: value.active, created_by: userId });
  if (error) {
    if (isSchemaGap(error)) throw new BucketError(BUCKET_PENDING_MESSAGE, 503);
    if (error.code === "23505") throw new BucketError("That agency already expects this carrier's file of that type. Edit it instead.", 409);
    if (error.code === "23503") throw new BucketError("Choose a carrier from the list.");
    throw new Error(`Could not save the expected file: ${error.message}`);
  }
}

export async function updateExpectation(tenantId: string, id: string, input: Pick<ExpectationInput, "weekdays" | "active">): Promise<void> {
  const weekdays = [...new Set(input.weekdays)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
  if (!weekdays.length) throw new BucketError("Choose at least one day of the week.");
  const { data, error } = await db().from("carrier_file_expectation").update({ weekdays, active: input.active, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id).select("id");
  if (error) throw new Error(`Could not save the expected file: ${error.message}`);
  if (!data?.length) throw new BucketError("That expected file is not in this workspace.", 404);
}

export async function removeExpectation(tenantId: string, id: string): Promise<void> {
  const { data, error } = await db().from("carrier_file_expectation").delete().eq("tenant_id", tenantId).eq("id", id).select("id");
  if (error) throw new Error(`Could not remove the expected file: ${error.message}`);
  if (!data?.length) throw new BucketError("That expected file is not in this workspace.", 404);
}
