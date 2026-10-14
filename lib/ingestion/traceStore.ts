import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { isKeptField } from "./layout";
import { columnTrace, unmatchedFields, type ColumnTrace, type MapEntryView, type RawColumnView } from "./trace";

/**
 * LA-4.20 (Notion sprint) · the bottom of the chain: one carrier file (what it is and every row),
 * one raw row (every original column, the map version that read it, what each column became, and
 * what it produced), and the database's list of figures that don't trace.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const TRACE_PENDING_MESSAGE = "The trace check needs a database update (20261008290000).";
const ROWS_PER_PAGE = 10;

export type FileTrace = {
  id: string;
  name: string;
  carrierId: string | null;
  carrierName: string | null;
  fileType: string | null;
  fileKind: string | null;
  fileDate: string | null;
  source: string;
  receivedAt: string;
  contentHash: string;
  bytes: number;
  status: string;
  errorDetail: string | null;
  map: { id: string; name: string; version: number } | null;
  parsedAt: string | null;
  rowCount: number | null;
  parsedRows: number | null;
  heldRows: number | null;
  supersededBy: string | null;
  rows: Array<{ rowNumber: number; preview: string[]; produced: string | null }>;
  headers: string[];
  /** How many of the file's columns the rows table shows (the rest open on the row's own page). */
  columnCount: number;
  page: number;
  pages: number;
  pageSize: number;
};

export async function loadFileTrace(tenantId: string, fileId: string, page = 1): Promise<FileTrace | null> {
  const { data: f, error } = await db().from("file_registry").select("id, original_filename, carrier_id, file_type, file_kind, file_date, source, received_at, content_hash, file_bytes, status, error_detail, parser_id, parser_version, parsed_at, row_count, parsed_row_count, held_row_count, superseded_by_file_id, raw_columns").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!f) return null;
  const pages = Math.max(1, Math.ceil((f.row_count ?? 0) / ROWS_PER_PAGE));
  const at = Math.min(Math.max(1, page), pages);
  const from = (at - 1) * ROWS_PER_PAGE;
  const columns = ((f.raw_columns ?? []) as RawColumnView[]).filter((c) => c.header.trim() !== "");
  // Every column of the file, as sent (owner request 2026-10-14: no need to open the carrier's file
  // to see a column); the table scrolls sideways, and each row's own page traces every value.
  const preview = columns;
  const [carrier, map, raw] = await Promise.all([
    f.carrier_id ? db().from("carriers").select("name").eq("id", f.carrier_id).maybeSingle() : { data: null },
    f.parser_id ? db().from("carrier_layout_map").select("id, name, version").eq("id", f.parser_id).maybeSingle() : { data: null },
    db().from("raw_rows").select("id, row_number, payload").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number").range(from, from + ROWS_PER_PAGE - 1),
  ]);
  const rawRows = (raw.data ?? []) as Loose[];
  const ids = rawRows.map((r) => r.id);
  const [snaps, lines] = ids.length ? await Promise.all([
    db().from("policy_snapshot").select("raw_row_id, policy_number").eq("tenant_id", tenantId).eq("file_id", fileId).in("raw_row_id", ids),
    db().from("commission_entry").select("raw_row_id, entry_type, amount_cents").eq("tenant_id", tenantId).eq("file_id", fileId).in("raw_row_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const producedBy = new Map<string, string>();
  for (const s of (snaps.data ?? []) as Loose[]) producedBy.set(s.raw_row_id, `Policy ${s.policy_number}`);
  for (const l of (lines.data ?? []) as Loose[]) producedBy.set(l.raw_row_id, [producedBy.get(l.raw_row_id), `${String(l.entry_type).replaceAll("_", " ")} line`].filter(Boolean).join(", "));
  return {
    id: f.id, name: f.original_filename, carrierId: f.carrier_id, carrierName: carrier.data?.name ?? null, fileType: f.file_type, fileKind: f.file_kind, fileDate: f.file_date,
    source: f.source, receivedAt: f.received_at, contentHash: f.content_hash, bytes: Number(f.file_bytes ?? 0), status: f.status, errorDetail: f.error_detail,
    map: map.data ? { id: map.data.id, name: map.data.name, version: map.data.version } : null,
    parsedAt: f.parsed_at, rowCount: f.row_count, parsedRows: f.parsed_row_count, heldRows: f.held_row_count, supersededBy: f.superseded_by_file_id,
    headers: preview.map((c) => c.header),
    columnCount: columns.length,
    rows: rawRows.map((r) => ({ rowNumber: r.row_number, preview: preview.map((c) => String(r.payload?.[c.key] ?? "")), produced: producedBy.get(r.id) ?? null })),
    page: at,
    pages,
    pageSize: ROWS_PER_PAGE,
  };
}

export type RowTrace = {
  file: { id: string; name: string; carrierName: string | null; fileType: string | null; fileDate: string | null; source: string; contentHash: string; status: string };
  rowNumber: number;
  rowCount: number | null;
  /** The row's place among the file's rows (1-based): row numbers are the sheet's, so a header makes them start at 2. */
  position: number | null;
  /** The sheet row numbers of the rows before and after this one, or null at either end. */
  prevRow: number | null;
  nextRow: number | null;
  map: { name: string; version: number; layoutKey: string } | null;
  columns: ColumnTrace[];
  missingFields: MapEntryView[];
  snapshot: { policyNumber: string; carrierId: string; snapshotDate: string; superseded: boolean; isCurrent: boolean } | null;
  lines: Array<{ id: string; type: string; amountCents: number; policyNumber: string; carrierId: string; transactionDate: string | null; statementDate: string | null }>;
};

export async function loadRowTrace(tenantId: string, fileId: string, rowNumber: number): Promise<RowTrace | null> {
  const [{ data: f, error }, { data: raw }] = await Promise.all([
    db().from("file_registry").select("id, original_filename, carrier_id, file_type, file_date, source, content_hash, status, parser_id, row_count, raw_columns").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle(),
    db().from("raw_rows").select("id, row_number, payload").eq("tenant_id", tenantId).eq("file_id", fileId).eq("row_number", rowNumber).maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!f || !raw) return null;
  const [carrier, map, entries, snapshot, lines, before, after, earlier] = await Promise.all([
    f.carrier_id ? db().from("carriers").select("name").eq("id", f.carrier_id).maybeSingle() : { data: null },
    f.parser_id ? db().from("carrier_layout_map").select("name, version, layout_key").eq("id", f.parser_id).maybeSingle() : { data: null },
    f.parser_id ? db().from("carrier_layout_map_entry").select("source_column, target_field, data_type, transform, required, sort_order").eq("map_id", f.parser_id).order("sort_order") : { data: [] },
    db().from("policy_snapshot").select("id, policy_number, carrier_id, snapshot_date, superseded, extra, carrier_status_raw, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date, premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier").eq("tenant_id", tenantId).eq("file_id", fileId).eq("raw_row_id", raw.id).maybeSingle(),
    db().from("commission_entry").select("id, entry_type, corrects_type, amount_cents, policy_number, carrier_id, transaction_date, statement_date, rate_bp, commissionable_premium_cents, months_advanced, agent_identifier, payee_level").eq("tenant_id", tenantId).eq("file_id", fileId).eq("raw_row_id", raw.id).order("created_at"),
    db().from("raw_rows").select("row_number").eq("tenant_id", tenantId).eq("file_id", fileId).lt("row_number", rowNumber).order("row_number", { ascending: false }).limit(1),
    db().from("raw_rows").select("row_number").eq("tenant_id", tenantId).eq("file_id", fileId).gt("row_number", rowNumber).order("row_number").limit(1),
    db().from("raw_rows").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("file_id", fileId).lt("row_number", rowNumber),
  ]);
  // A column the layout lists as kept is read into nothing: it shows with the columns kept, not read.
  const mapEntries: MapEntryView[] = ((entries.data ?? []) as Loose[]).filter((e) => !isKeptField(e.target_field)).map((e) => ({ sourceColumn: e.source_column, targetField: e.target_field, dataType: e.data_type, transform: e.transform, required: Boolean(e.required) }));
  const columns = ((f.raw_columns ?? []) as RawColumnView[]).filter((c) => c.header.trim() !== "");
  const s = snapshot.data as Loose;
  const line = ((lines.data ?? []) as Loose[])[0];
  // What landed, keyed by the map's target fields (snapshot columns, or the commission line's).
  // The map's target fields are the snapshot's and the commission line's own column names (layout.ts).
  const stored: Record<string, string | number | null> = s ?? line ?? {};
  const isCurrent = s ? Boolean((await db().from("policy_current").select("snapshot_id").eq("tenant_id", tenantId).eq("carrier_id", s.carrier_id).eq("policy_number", s.policy_number).maybeSingle()).data?.snapshot_id === s.id) : false;
  return {
    file: { id: f.id, name: f.original_filename, carrierName: carrier.data?.name ?? null, fileType: f.file_type, fileDate: f.file_date, source: f.source, contentHash: f.content_hash, status: f.status },
    rowNumber: raw.row_number,
    rowCount: f.row_count,
    position: typeof earlier.count === "number" ? earlier.count + 1 : null,
    prevRow: (before.data as Loose[] | null)?.[0]?.row_number ?? null,
    nextRow: (after.data as Loose[] | null)?.[0]?.row_number ?? null,
    map: map.data ? { name: map.data.name, version: map.data.version, layoutKey: map.data.layout_key } : null,
    columns: columnTrace(columns, raw.payload ?? {}, mapEntries, stored, s?.extra ?? null),
    missingFields: unmatchedFields(columns, mapEntries),
    snapshot: s ? { policyNumber: s.policy_number, carrierId: s.carrier_id, snapshotDate: s.snapshot_date, superseded: Boolean(s.superseded), isCurrent } : null,
    lines: ((lines.data ?? []) as Loose[]).map((l) => ({ id: l.id, type: l.entry_type === "reversal" && l.corrects_type ? `reversal of ${l.corrects_type}` : l.entry_type, amountCents: Number(l.amount_cents), policyNumber: l.policy_number, carrierId: l.carrier_id, transactionDate: l.transaction_date, statementDate: l.statement_date })),
  };
}

/**
 * The agency's discrepancies whose trace is broken on either side, by id, with why. They are not
 * shown: an unverifiable accusation is worse than silence. Null before the migration (nothing is
 * withheld then, as before).
 */
export async function untraceableDiscrepancies(tenantId: string): Promise<Map<string, string> | null> {
  const { data, error } = await db().rpc("trace_problems", { p_tenant_id: tenantId });
  if (error) {
    if (isSchemaGap(error) || error.code === "PGRST202") return null;
    throw new Error(`Could not check the discrepancies' trace: ${error.message}`);
  }
  const out = new Map<string, string>();
  for (const p of (data ?? []) as Loose[]) if (p.screen === "discrepancies") out.set(p.subject, p.reason);
  return out;
}

/** The ledger lines behind a list of entry ids, with the file row each came from (for the discrepancy panel). */
export async function entrySources(tenantId: string, ids: string[]): Promise<Map<string, { fileId: string; rowNumber: number | null; fileName: string | null; type: string; amountCents: number }>> {
  const unique = [...new Set(ids)].slice(0, 2000);
  const out = new Map<string, { fileId: string; rowNumber: number | null; fileName: string | null; type: string; amountCents: number }>();
  // commission_entry reaches its file through its raw row (no direct key to embed), so the names are read apart.
  const rows: Loose[] = [];
  for (let at = 0; at < unique.length; at += 200) {
    const { data, error } = await db().from("commission_entry").select("id, file_id, row_number, entry_type, amount_cents").eq("tenant_id", tenantId).in("id", unique.slice(at, at + 200));
    if (error) throw new Error(`Could not read the ledger lines: ${error.message}`);
    rows.push(...(data ?? []));
  }
  const fileIds = [...new Set(rows.map((e) => e.file_id as string))];
  const { data: files, error } = fileIds.length ? await db().from("file_registry").select("id, original_filename").eq("tenant_id", tenantId).in("id", fileIds) : { data: [], error: null };
  if (error) throw new Error(`Could not read the files: ${error.message}`);
  const name = new Map<string, string>(((files ?? []) as Loose[]).map((f) => [f.id, f.original_filename]));
  for (const e of rows) out.set(e.id, { fileId: e.file_id, rowNumber: e.row_number, fileName: name.get(e.file_id) ?? null, type: e.entry_type, amountCents: Number(e.amount_cents) });
  return out;
}
