import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { reprocessCarrierFiles } from "./reprocessRuns";
import { isNormalizedStatus, type NormalizedStatus } from "./statuses";

/**
 * LA-4.5 (Notion sprint) · the unknown-status queue and the status map, for staff.
 *
 * A carrier's word means the same for every agency, so mappings are platform data: staff map a
 * word from the queue (which gathers it across agencies) and approve it. Approval is what makes it
 * take effect, resolves every agency's queue entry for that word, and reprocesses the files whose
 * rows were held — from their raw rows, with nothing uploaded again. An approved mapping never
 * changes (the database refuses), because files were read with it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class StatusMapError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StatusMapError";
  }
}

export const STATUS_MAPS_PENDING_MESSAGE = "The status map needs a database update (20261008130000).";

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new StatusMapError(STATUS_MAPS_PENDING_MESSAGE, 503);
  if (error.code === "P0001") throw new StatusMapError(error.message, 409);
  if (error.code === "23505") throw new StatusMapError("That carrier word already has a mapping.", 409);
  throw new Error(`${fallback}: ${error.message}`);
}

export type QueueEntry = {
  carrierId: string;
  carrierName: string;
  fileType: "policies" | "commissions";
  raw: string;
  rows: number;
  agencies: number;
  firstSeenAt: string;
  proposal: { mapId: string; status: NormalizedStatus } | null;
};

export type MappingRow = {
  id: string;
  carrierId: string;
  carrierName: string;
  fileType: "policies" | "commissions";
  raw: string;
  status: NormalizedStatus;
  approvedAt: string | null;
  mappedAt: string;
  notes: string | null;
};

export async function listStatusQueue(): Promise<{ queue: QueueEntry[]; mappings: MappingRow[]; carriers: Array<{ id: string; name: string }> }> {
  const [queue, mappings, carriers] = await Promise.all([
    db().from("unmapped_status_queue").select("carrier_id, file_type, carrier_status_raw, row_count, tenant_id, first_seen_at, carriers(name)").is("resolved_at", null).limit(5000),
    db().from("carrier_status_map").select("id, carrier_id, file_type, carrier_status_raw, status_normalized, approved_at, mapped_at, notes, carriers(name)").order("mapped_at", { ascending: false }).limit(2000),
    db().from("carriers").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (queue.error) fail(queue.error, "Could not load the status queue");
  if (mappings.error) fail(mappings.error, "Could not load the status map");
  if (carriers.error) fail(carriers.error, "Could not load carriers");
  const mapRows: MappingRow[] = (mappings.data ?? []).map((row: Loose) => ({ id: row.id, carrierId: row.carrier_id, carrierName: row.carriers?.name ?? "", fileType: row.file_type, raw: row.carrier_status_raw, status: row.status_normalized, approvedAt: row.approved_at, mappedAt: row.mapped_at, notes: row.notes }));
  // One line per carrier word, gathered across agencies (a word means the same everywhere).
  const grouped = new Map<string, QueueEntry & { tenants: Set<string> }>();
  for (const row of (queue.data ?? []) as Loose[]) {
    if (!row.row_count) continue;
    const key = `${row.carrier_id}\u0000${row.file_type}\u0000${row.carrier_status_raw}`;
    const entry = grouped.get(key) ?? { carrierId: row.carrier_id, carrierName: row.carriers?.name ?? "", fileType: row.file_type, raw: row.carrier_status_raw, rows: 0, agencies: 0, firstSeenAt: row.first_seen_at, proposal: null, tenants: new Set<string>() };
    entry.rows += row.row_count;
    entry.tenants.add(row.tenant_id);
    if (row.first_seen_at < entry.firstSeenAt) entry.firstSeenAt = row.first_seen_at;
    grouped.set(key, entry);
  }
  const queueEntries = [...grouped.values()].map(({ tenants, ...entry }) => {
    const proposal = mapRows.find((map) => !map.approvedAt && map.carrierId === entry.carrierId && map.fileType === entry.fileType && map.raw === entry.raw);
    return { ...entry, agencies: tenants.size, proposal: proposal ? { mapId: proposal.id, status: proposal.status } : null };
  }).sort((a, b) => b.rows - a.rows);
  return { queue: queueEntries, mappings: mapRows, carriers: carriers.data ?? [] };
}

export type ApprovalResult = { mapId: string; files: number; reprocessed: number; failed: number };

async function reprocessHeld(files: Array<{ tenant_id: string; file_id: string }>): Promise<{ reprocessed: number; failed: number }> {
  let reprocessed = 0;
  let failed = 0;
  for (const file of files) {
    const run = await reprocessCarrierFiles(file.tenant_id, null, { kind: "file", fileId: file.file_id }, "status_map_approval").catch(() => null);
    if (run?.status === "succeeded") reprocessed++;
    else failed++;
  }
  return { reprocessed, failed };
}

async function approve(adminId: string, mapId: string): Promise<{ files: Array<{ tenant_id: string; file_id: string }> }> {
  const { data, error } = await db().rpc("approve_status_mapping", { p_map_id: mapId, p_admin_id: adminId, p_user_id: null });
  if (error) fail(error, "Could not approve the mapping");
  return { files: (data ?? []) as Array<{ tenant_id: string; file_id: string }> };
}

/**
 * Maps one carrier word (exactly as given — never trimmed) to one of the nine statuses and approves
 * it in one step. The files whose rows were held are returned for reprocessing by the caller.
 */
export async function mapAndApproveStatus(adminId: string, input: { carrierId: string; fileType: "policies" | "commissions"; raw: string; status: string; notes: string | null }): Promise<{ mapId: string; files: Array<{ tenant_id: string; file_id: string }> }> {
  if (!isNormalizedStatus(input.status)) throw new StatusMapError("Choose one of the nine statuses.", 400);
  if (!input.raw.length || input.raw.length > 200) throw new StatusMapError("The carrier's word is missing.", 400);
  const { data: existing, error } = await db().from("carrier_status_map").select("id, approved_at").eq("carrier_id", input.carrierId).eq("file_type", input.fileType).eq("carrier_status_raw", input.raw).maybeSingle();
  if (error) fail(error, "Could not read the status map");
  if (existing?.approved_at) throw new StatusMapError("That carrier word is already mapped.", 409);
  let mapId: string;
  if (existing) {
    const { error: updateError } = await db().from("carrier_status_map").update({ status_normalized: input.status, notes: input.notes, mapped_by_admin: adminId, mapped_at: new Date().toISOString() }).eq("id", existing.id);
    if (updateError) fail(updateError, "Could not update the proposed mapping");
    mapId = existing.id;
  } else {
    const { data, error: insertError } = await db().from("carrier_status_map").insert({ carrier_id: input.carrierId, file_type: input.fileType, carrier_status_raw: input.raw, status_normalized: input.status, notes: input.notes, mapped_by_admin: adminId }).select("id").single();
    if (insertError) fail(insertError, "Could not save the mapping");
    mapId = data.id;
  }
  const { files } = await approve(adminId, mapId);
  return { mapId, files };
}

/** Approves a proposed mapping (one a person or the guardian proposed earlier). */
export async function approveProposedMapping(adminId: string, mapId: string) {
  return approve(adminId, mapId);
}

/** Drops a proposal nobody approved. An approved mapping is refused by the database. */
export async function discardProposedMapping(mapId: string): Promise<void> {
  const { data, error } = await db().from("carrier_status_map").delete().eq("id", mapId).is("approved_at", null).select("id");
  if (error) fail(error, "Could not discard the proposal");
  if (!data?.length) throw new StatusMapError("Only a proposal nobody approved can be discarded.", 409);
}

export { reprocessHeld };

/** The agency's own open words, for its Carrier files page. */
export async function listOpenUnmappedStatuses(tenantId: string): Promise<{ available: boolean; entries: Array<{ carrierName: string; raw: string; rows: number }> }> {
  const { data, error } = await db().from("unmapped_status_queue").select("carrier_status_raw, row_count, carriers(name)").eq("tenant_id", tenantId).is("resolved_at", null).gt("row_count", 0).order("row_count", { ascending: false }).limit(50);
  if (error) {
    if (isSchemaGap(error)) return { available: false, entries: [] };
    throw new Error(`Could not load unmapped statuses: ${error.message}`);
  }
  return { available: true, entries: (data ?? []).map((row: Loose) => ({ carrierName: row.carriers?.name ?? "", raw: row.carrier_status_raw, rows: row.row_count })) };
}
