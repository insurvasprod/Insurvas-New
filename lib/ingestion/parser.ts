import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { chooseLayoutMap, parseWithMap, type Finding, type LayoutEntry, type LayoutMap, type ParseResult, type PublishedMapRow } from "./layout";
import type { RawColumn, RawRow } from "./grid";
import { readRawRows } from "./rawLayer";

/**
 * LA-4.3 (Notion sprint) · parsing registered files with their carrier's layout map, server side.
 *
 * Which map: the carrier's layout for this file type — the agency's own assignment, else the
 * platform's — at its published version, the agency's own version first, then the platform's.
 * Nothing found is "no layout map for this carrier and file type": the file waits (parse_block)
 * and is parsed the moment one is published.
 *
 * Every parse records on the file the map id and version that read it, and writes what the parser
 * guardian noticed to agent_findings. No model runs here.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const NO_LAYOUT_MAP_MESSAGE = "No layout map for this carrier and file type yet. The file is kept and will be read as soon as one is published.";

type ResolvedMap = { map: LayoutMap; entries: LayoutEntry[]; scope: "tenant" | "platform"; layoutKey: string; name: string };

function toMap(row: Loose): LayoutMap {
  return { id: row.id, version: row.version, fileType: row.file_type, headerRowIndex: row.header_row_index, sheetName: row.sheet_name, rowCountSwingPct: row.row_count_swing_pct, totalRowColumn: row.total_row_column, totalRowValue: row.total_row_value };
}

function toEntry(row: Loose): LayoutEntry {
  return { sourceColumn: row.source_column, targetField: row.target_field, dataType: row.data_type, transform: row.transform, required: row.required, enumValues: row.enum_values };
}

const MAP_COLUMNS = "id, tenant_id, layout_key, name, file_type, version, header_row_index, sheet_name, row_count_swing_pct, total_row_column, total_row_value, carrier_layout_map_entry(source_column, target_field, data_type, transform, required, sort_order, enum_values)";

/** The layout map a carrier's file of this type is read with for this agency, or null. */
export async function resolveLayoutMap(tenantId: string, carrierId: string, fileType: "policies" | "commissions"): Promise<ResolvedMap | null> {
  const { data: assignments, error } = await db().from("carrier_layout_assignment").select("tenant_id, carrier_id, file_type, layout_key").eq("carrier_id", carrierId).eq("file_type", fileType).or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  if (error) throw new Error(`Could not read layout assignments: ${error.message}`);
  const assignmentRows = (assignments ?? []).map((row: Loose) => ({ tenantId: row.tenant_id, carrierId: row.carrier_id, fileType: row.file_type, layoutKey: row.layout_key }));
  if (!assignmentRows.length) return null;
  const keys = [...new Set(assignmentRows.map((row: Loose) => row.layoutKey))];
  const { data: maps, error: mapError } = await db().from("carrier_layout_map").select(MAP_COLUMNS).in("layout_key", keys).eq("status", "published").eq("file_type", fileType).or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  if (mapError) throw new Error(`Could not read the layout map: ${mapError.message}`);
  const candidates: Array<PublishedMapRow & { row: Loose }> = (maps ?? []).map((row: Loose) => ({ id: row.id, tenantId: row.tenant_id, layoutKey: row.layout_key, fileType: row.file_type, status: "published", row }));
  const picked = chooseLayoutMap({ tenantId, carrierId, fileType, assignments: assignmentRows, maps: candidates });
  const chosen = picked?.row;
  if (!chosen) return null;
  const entries = [...(chosen.carrier_layout_map_entry ?? [])].sort((a: Loose, b: Loose) => a.sort_order - b.sort_order).map(toEntry);
  return { map: toMap(chosen), entries, scope: chosen.tenant_id ? "tenant" : "platform", layoutKey: chosen.layout_key, name: chosen.name };
}

async function writeFindings(tenantId: string, fileId: string, map: LayoutMap, findings: Finding[]) {
  if (!findings.length) return;
  const rows = findings.map((finding) => ({
    tenant_id: tenantId,
    agent_name: "parser_guardian",
    file_id: fileId,
    map_id: map.id,
    map_version: map.version,
    finding_type: finding.findingType,
    severity: finding.severity,
    payload: finding.payload,
    reasoning: finding.reasoning.slice(0, 4000),
    // One finding per file, map version and kind: re-parsing with the same version says it once.
    dedupe_key: `${fileId}:${map.id}:${finding.findingType}`,
  }));
  const { error } = await db().from("agent_findings").upsert(rows, { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(`The parser's findings could not be recorded: ${error.message}`);
}

async function previousParsedCount(tenantId: string, file: Loose): Promise<number | null> {
  const { data, error } = await db().from("file_registry").select("parsed_row_count").eq("tenant_id", tenantId).eq("carrier_id", file.carrier_id).eq("file_type", file.file_type).neq("id", file.id).lt("file_date", file.file_date).not("parsed_row_count", "is", null).order("file_date", { ascending: false }).limit(1);
  if (error) throw new Error(`Could not read the previous file: ${error.message}`);
  return data?.[0]?.parsed_row_count ?? null;
}

export type ParseOutcome =
  | { outcome: "parsed"; mapId: string; version: number; rows: number; findings: number; result: ParseResult }
  | { outcome: "failed"; mapId: string; version: number; reason: string; result: ParseResult }
  | { outcome: "no_layout_map" }
  | { outcome: "not_applicable"; reason: string }
  | { outcome: "pending_schema" };

/**
 * Parses one file whose raw rows are sealed. Pass `rows` when they are already read (a reprocess).
 * A replaced file keeps its status; only its parser record moves.
 */
export async function parseCarrierFile(tenantId: string, fileId: string, rows?: RawRow[]): Promise<ParseOutcome> {
  const { data: file, error } = await db().from("file_registry").select("id, carrier_id, file_type, file_date, status, parse_block, raw_extracted_at, raw_header_row, raw_columns, raw_preamble, sheet_name").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return { outcome: "pending_schema" };
    throw new Error(`Could not load the file: ${error.message}`);
  }
  if (!file || !file.raw_extracted_at) return { outcome: "not_applicable", reason: "its raw rows are not sealed" };
  if (file.status === "failed" && file.parse_block !== "no_layout_map") return { outcome: "not_applicable", reason: "the file failed for another reason" };
  const movesStatus = file.status !== "superseded";

  let resolved: ResolvedMap | null;
  try {
    resolved = await resolveLayoutMap(tenantId, file.carrier_id, file.file_type);
  } catch (failure) {
    if (failure instanceof Error && /does not exist|schema cache/i.test(failure.message)) return { outcome: "pending_schema" };
    throw failure;
  }
  if (!resolved) {
    if (movesStatus) await db().from("file_registry").update({ status: "failed", error_detail: NO_LAYOUT_MAP_MESSAGE, parse_block: "no_layout_map" }).eq("tenant_id", tenantId).eq("id", fileId);
    return { outcome: "no_layout_map" };
  }

  if (movesStatus) await db().from("file_registry").update({ status: "parsing", error_detail: null, parse_block: null }).eq("tenant_id", tenantId).eq("id", fileId);
  const raw = {
    headerRow: file.raw_header_row as number,
    columns: file.raw_columns as RawColumn[],
    preamble: file.raw_preamble as string[][],
    rows: rows ?? (await readRawRows(tenantId, fileId)),
    sheetName: file.sheet_name as string | null,
  };
  const result = parseWithMap({ map: resolved.map, entries: resolved.entries, raw, previousRowCount: await previousParsedCount(tenantId, file) });
  await writeFindings(tenantId, fileId, resolved.map, result.findings);

  const parser = { parser_id: resolved.map.id, parser_version: resolved.map.version };
  if (result.fatal) {
    await db().from("file_registry").update(movesStatus ? { ...parser, status: "failed", error_detail: result.fatal.slice(0, 2000), parsed_row_count: null } : { ...parser, parsed_row_count: null }).eq("tenant_id", tenantId).eq("id", fileId);
    return { outcome: "failed", mapId: resolved.map.id, version: resolved.map.version, reason: result.fatal, result };
  }
  await db().from("file_registry").update(movesStatus ? { ...parser, status: "parsed", parsed_at: new Date().toISOString(), parsed_row_count: result.rows.length } : { ...parser, parsed_at: new Date().toISOString(), parsed_row_count: result.rows.length }).eq("tenant_id", tenantId).eq("id", fileId);
  return { outcome: "parsed", mapId: resolved.map.id, version: resolved.map.version, rows: result.rows.length, findings: result.findings.length, result };
}

export type ParseSweep = { available: boolean; parsed: number; failed: number; waiting: number; errors: string[] };

/** Parses every sealed file not yet parsed, and retries those waiting for a layout map. Run by the poll. */
export async function parsePendingFiles(limit = 20): Promise<ParseSweep> {
  const outcome: ParseSweep = { available: true, parsed: 0, failed: 0, waiting: 0, errors: [] };
  const [fresh, blocked] = await Promise.all([
    db().from("file_registry").select("id, tenant_id").not("raw_extracted_at", "is", null).eq("status", "received").is("parser_id", null).order("received_at").limit(limit),
    db().from("file_registry").select("id, tenant_id").eq("status", "failed").eq("parse_block", "no_layout_map").order("received_at").limit(limit),
  ]);
  for (const read of [fresh, blocked]) {
    if (read.error) {
      if (isSchemaGap(read.error) || read.error.code === "42703") return { ...outcome, available: false };
      throw new Error(`Could not list files to parse: ${read.error.message}`);
    }
  }
  for (const file of [...(fresh.data ?? []), ...(blocked.data ?? [])] as Array<{ id: string; tenant_id: string }>) {
    try {
      const result = await parseCarrierFile(file.tenant_id, file.id);
      if (result.outcome === "parsed") outcome.parsed++;
      else if (result.outcome === "failed") outcome.failed++;
      else if (result.outcome === "no_layout_map") outcome.waiting++;
      else if (result.outcome === "pending_schema") return { ...outcome, available: false };
    } catch (failure) {
      outcome.errors.push(`${file.id}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  return outcome;
}

/** For after() in a door: read the rows, then parse them; never fails the request. */
export async function processFileQuietly(tenantId: string, fileId: string, extract: (tenantId: string, fileId: string) => Promise<unknown>): Promise<void> {
  try {
    await extract(tenantId, fileId);
    await parseCarrierFile(tenantId, fileId);
  } catch (error) {
    console.error(`[parser] ${fileId} failed; the next sweep retries:`, error);
  }
}
