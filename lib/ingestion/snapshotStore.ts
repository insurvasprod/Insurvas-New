import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { isPolicyFeed } from "./constants";
import type { RawColumn } from "./grid";
import { isKeptField } from "./layout";
import { recordCarrierIssues } from "./applicationIssueStore";
import { refreshPolicyCurrent } from "./policyCurrentStore";
import { matchFilePolicies } from "./policyMatchingStore";
import { historyOf, snapshotContent, snapshotsForFile, TRACKED_FIELDS, type StoredSnapshot, type TrackedField } from "./snapshots";

/**
 * LA-4.6 (Notion sprint) · writing Layer 2 for one policy file.
 *
 *   1. its typed rows (gated by LA-4.5) become one snapshot per policy, each pointing at its raw row,
 *      with every field the map read and every column it did not;
 *   2. replace_file_snapshots swaps in that file's snapshots (and marks a replaced file's ones
 *      superseded) — the only way a snapshot is ever written;
 *   3. the history of every policy it touched is recomputed from ALL that policy's snapshots and
 *      swapped in by replace_policy_changes — so a back-dated file corrects the changes around it,
 *      and no other policy is touched.
 *
 * Idempotent: the same raw rows give the same snapshots and the same history; `changed` counts
 * snapshots whose content moved.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const POLICY_CHUNK = 200;
/** Postgres cancelling a statement for its time limit (57014): a busy moment, worth one more try. */
const STATEMENT_TIMEOUT = /statement timeout|canceling statement/i;

export type SnapshotOutcome = { available: boolean; changed: number; snapshots: number; policies: number; duplicates: number };

async function rawRowIndex(tenantId: string, fileId: string): Promise<{ ids: Map<number, string>; payloads: Map<number, Record<string, string>> }> {
  const ids = new Map<number, string>();
  const payloads = new Map<number, Record<string, string>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("raw_rows").select("id, row_number, payload").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number").range(from, from + 999);
    if (error) throw new Error(`Could not read the raw rows: ${error.message}`);
    for (const row of data ?? []) { ids.set(row.row_number, row.id); payloads.set(row.row_number, row.payload); }
    if ((data ?? []).length < 1000) break;
  }
  return { ids, payloads };
}

async function policyHistoryInputs(tenantId: string, carrierId: string, policies: string[]): Promise<StoredSnapshot[]> {
  const out: StoredSnapshot[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db()
      .from("policy_snapshot")
      .select(`policy_number, snapshot_date, file_id, superseded, ${TRACKED_FIELDS.join(", ")}, file_registry!policy_snapshot_file_id_fkey(received_at, file_type)`)
      .eq("tenant_id", tenantId)
      .eq("carrier_id", carrierId)
      .in("policy_number", policies)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Could not read the policies' snapshots: ${error.message}`);
    for (const row of (data ?? []) as Loose[]) {
      // A new-business snapshot the day's policy file set aside (20261009140000) is no part of the
      // policy's history: reading it would flip the status back and forth. A reissue's stays (the
      // correction is a change like any other).
      if (row.superseded && row.file_registry?.file_type === "new_business") continue;
      const values = Object.fromEntries(TRACKED_FIELDS.map((field) => [field, row[field] ?? null])) as Record<TrackedField, string | number | null>;
      out.push({ policyNumber: row.policy_number, snapshotDate: row.snapshot_date, fileId: row.file_id, fileReceivedAt: row.file_registry?.received_at ?? "", values });
    }
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/**
 * Rebuilds one policy file's snapshots from its typed rows, then the history of the policies it
 * touched, then their links and current rows. A reprocess runs it whole; the LA-4.19 run takes it in
 * its two stages, STORE (storeFileSnapshots) and MATCH (linkFilePolicies), and records each.
 */
export async function rebuildFileSnapshots(tenantId: string, fileId: string, typedRows: Array<{ rowNumber: number; values: Record<string, string | number | null> }>): Promise<SnapshotOutcome> {
  const stored = await storeFileSnapshots(tenantId, fileId, typedRows);
  if (!stored.available || !stored.carrierId) return stored;
  await linkFilePolicies(tenantId, fileId, { carrierId: stored.carrierId, policies: stored.policyNumbers, swallowMatchErrors: true });
  return stored;
}

export type StoreOutcome = SnapshotOutcome & { carrierId: string | null; policyNumbers: string[] };

/** STORE: the file's snapshots (Layer 2), then the change log of every policy it touched. */
export async function storeFileSnapshots(tenantId: string, fileId: string, typedRows: Array<{ rowNumber: number; values: Record<string, string | number | null> }>): Promise<StoreOutcome> {
  const none = { available: true, changed: 0, snapshots: 0, policies: 0, duplicates: 0, carrierId: null, policyNumbers: [] };
  const { data: file, error } = await db().from("file_registry").select("id, file_type, parser_id, raw_columns").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!file || !isPolicyFeed(file.file_type)) return none;

  // The columns the map did not read go into each snapshot's `extra`, so no field is ever dropped.
  const { data: entries } = file.parser_id ? await db().from("carrier_layout_map_entry").select("source_column, target_field").eq("map_id", file.parser_id) : { data: [] };
  // Spaces around a header ignored, as the parser matches them (layout.ts parseWithMap). A column the
  // layout lists as kept is not read, so it travels in `extra` like any other.
  const read = new Set(((entries ?? []) as Array<{ source_column: string; target_field: string }>).filter((entry) => !isKeptField(entry.target_field)).flatMap((entry) => entry.source_column.split(" + ")).map((name) => name.trim()));
  const columns = ((file.raw_columns ?? []) as RawColumn[]).filter((column) => column.header.trim() !== "" && !read.has(column.header.trim()));
  const { ids, payloads } = await rawRowIndex(tenantId, fileId);
  const unreadColumnsOf = (rowNumber: number) => Object.fromEntries(columns.map((column) => [column.header, payloads.get(rowNumber)?.[column.key] ?? ""]));

  const { snapshots, duplicates } = snapshotsForFile(typedRows, ids, unreadColumnsOf);
  const rows = snapshots.map((snapshot) => ({ ...snapshot, content_hash: createHash("sha256").update(snapshotContent(snapshot)).digest("hex") }));
  // One transaction, so a write cut off by the statement timeout changed nothing and is tried again:
  // 990 AHL rows timed out on 2026-10-13 only while six other files were being written at once.
  let { data: replaced, error: replaceError } = await db().rpc("replace_file_snapshots", { p_tenant_id: tenantId, p_file_id: fileId, p_rows: rows });
  for (const pause of [2_000, 6_000]) {
    if (!replaceError || !STATEMENT_TIMEOUT.test(replaceError.message ?? "")) break;
    await new Promise((resolve) => setTimeout(resolve, pause));
    ({ data: replaced, error: replaceError } = await db().rpc("replace_file_snapshots", { p_tenant_id: tenantId, p_file_id: fileId, p_rows: rows }));
  }
  if (replaceError) {
    if (isSchemaGap(replaceError)) return { ...none, available: false };
    throw new Error(`The file's snapshots could not be written: ${replaceError.message}`);
  }
  const result = replaced as { changed: number; policies: string[]; carrier_id: string };

  if (duplicates.length) {
    await db().from("agent_findings").upsert([{
      tenant_id: tenantId,
      agent_name: "parser_guardian",
      file_id: fileId,
      finding_type: "duplicate_policy_rows",
      severity: "warning",
      payload: { duplicates: duplicates.slice(0, 50) },
      reasoning: `${duplicates.length} ${duplicates.length === 1 ? "policy is" : "policies are"} listed more than once in this file; the first row of each was kept (first: ${duplicates[0].policyNumber} on line ${duplicates[0].rowNumber}, kept line ${duplicates[0].keptRow}).`,
      dedupe_key: `${fileId}:duplicate_policy_rows`,
    }], { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
  }

  for (let start = 0; start < result.policies.length; start += POLICY_CHUNK) {
    const chunk = result.policies.slice(start, start + POLICY_CHUNK);
    const history = historyOf(await policyHistoryInputs(tenantId, result.carrier_id, chunk));
    const { error: historyError } = await db().rpc("replace_policy_changes", { p_tenant_id: tenantId, p_carrier_id: result.carrier_id, p_policies: chunk, p_changes: history.changes, p_events: history.events });
    if (historyError) throw new Error(`The policies' history could not be written: ${historyError.message}`);
  }
  return { available: true, changed: result.changed, snapshots: rows.length, policies: result.policies.length, duplicates: duplicates.length, carrierId: result.carrier_id, policyNumbers: result.policies };
}

/** The policy numbers a policy file's own snapshots hold (MATCH run on its own, after STORE in an earlier run). */
export async function filePolicyNumbers(tenantId: string, fileId: string): Promise<{ carrierId: string | null; policies: string[] }> {
  const policies = new Set<string>();
  let carrierId: string | null = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("policy_snapshot").select("carrier_id, policy_number").eq("tenant_id", tenantId).eq("file_id", fileId).order("policy_number").order("id").range(from, from + 999);
    if (error) throw new Error(`Could not read the file's policies: ${error.message}`);
    for (const row of (data ?? []) as Loose[]) { carrierId = row.carrier_id; policies.add(row.policy_number); }
    if ((data ?? []).length < 1000) break;
  }
  return { carrierId, policies: [...policies] };
}

/**
 * MATCH: link the file's policies to our clients (LA-4.8), then refresh their current rows (Layer 3:
 * lapsed_on and issued_on read the history, the links the ladder made). A matching failure never
 * loses the snapshots, and the current rows are refreshed without the links before it is reported.
 */
export async function linkFilePolicies(tenantId: string, fileId: string, input: { carrierId: string; policies: string[]; swallowMatchErrors?: boolean }): Promise<{ policies: number }> {
  let matchFailure: unknown = null;
  for (let start = 0; start < input.policies.length; start += POLICY_CHUNK) {
    const chunk = input.policies.slice(start, start + POLICY_CHUNK);
    try {
      await matchFilePolicies(tenantId, input.carrierId, fileId, chunk);
    } catch (matchError) {
      console.error("[policy-matching]", fileId, matchError);
      matchFailure ??= matchError;
    }
    await refreshPolicyCurrent({ tenantId, carrierId: input.carrierId, policies: chunk });
    // LA-3.18: a linked application still waiting on the carrier is closed as issued when the
    // carrier's file shows the policy issued. Never throws.
    await recordCarrierIssues(tenantId, input.carrierId, chunk);
  }
  await db().from("file_registry").update({ derived_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", fileId);
  if (matchFailure && !input.swallowMatchErrors) throw matchFailure;
  return { policies: input.policies.length };
}

export type ChangeRow = {
  id: string;
  carrierId: string;
  carrierName: string;
  policyNumber: string;
  /** The file that showed the new value: the change opens it. */
  toFileId: string;
  fieldName: TrackedField;
  oldValue: string | null;
  newValue: string | null;
  fromDate: string;
  toDate: string;
};

/** The agency's most recent policy changes, newest file date first. */
export async function listPolicyChanges(tenantId: string, limit = 500): Promise<{ available: boolean; changes: ChangeRow[] }> {
  const { data, error } = await db().from("policy_change").select("id, carrier_id, policy_number, field_name, old_value, new_value, from_snapshot_date, to_snapshot_date, to_file_id, carriers(name)").eq("tenant_id", tenantId).order("to_snapshot_date", { ascending: false }).order("policy_number").limit(limit);
  if (error) {
    if (isSchemaGap(error)) return { available: false, changes: [] };
    throw new Error(`Could not load policy changes: ${error.message}`);
  }
  return { available: true, changes: (data ?? []).map((row: Loose) => ({ id: row.id, carrierId: row.carrier_id, carrierName: row.carriers?.name ?? "", policyNumber: row.policy_number, toFileId: row.to_file_id, fieldName: row.field_name, oldValue: row.old_value, newValue: row.new_value, fromDate: row.from_snapshot_date, toDate: row.to_snapshot_date })) };
}
