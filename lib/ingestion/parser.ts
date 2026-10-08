import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { sendEmail } from "@/lib/email/transport";

import { isPolicyFeed, type CarrierFileType } from "./constants";
import { chooseLayoutMap, parseWithMap, type Finding, type LayoutEntry, type LayoutMap, type ParseResult, type PublishedMapRow, type TypedRow } from "./layout";
import type { RawColumn, RawRow } from "./grid";
import { extractRawRows, readRawRows } from "./rawLayer";
import { runStages } from "./stages";
import { gateStatuses, shownWord, type NormalizedStatus } from "./statuses";

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
export async function resolveLayoutMap(tenantId: string, carrierId: string, fileType: CarrierFileType): Promise<ResolvedMap | null> {
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
  /** `passed` are the rows that go downstream: for a policy file, those whose status is mapped (LA-4.5). */
  | { outcome: "parsed"; mapId: string; version: number; rows: number; findings: number; result: ParseResult; passed: TypedRow[]; heldRows: number }
  | { outcome: "failed"; mapId: string; version: number; reason: string; result: ParseResult }
  | { outcome: "no_layout_map" }
  | { outcome: "not_applicable"; reason: string }
  | { outcome: "pending_schema" };

/**
 * Parses one file whose raw rows are sealed. Pass `rows` when they are already read (a reprocess).
 * A replaced file keeps its status; only its parser record moves.
 */
export async function parseCarrierFile(tenantId: string, fileId: string, rows?: RawRow[]): Promise<ParseOutcome> {
  const columns = "id, carrier_id, file_type, file_date, status, parse_block, parser_id, raw_extracted_at, raw_header_row, raw_columns, raw_preamble, sheet_name, file_kind";
  let { data: file, error } = await db().from("file_registry").select(columns).eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return { outcome: "pending_schema" };
    throw new Error(`Could not load the file: ${error.message}`);
  }
  // A PDF waits for its PDF layout before it has rows at all. When one may have been published, it
  // goes back to received and is read into rows first; without a layout it simply waits again.
  if (file && !file.raw_extracted_at && file.file_kind === "pdf" && file.status === "failed" && file.parse_block === "no_layout_map") {
    await db().from("file_registry").update({ status: "received", error_detail: null, parse_block: null }).eq("tenant_id", tenantId).eq("id", fileId).eq("status", "failed");
    const extracted = await extractRawRows(tenantId, fileId);
    if (extracted.outcome !== "extracted" && extracted.outcome !== "already") return extracted.outcome === "failed" ? { outcome: "not_applicable", reason: extracted.reason } : { outcome: "no_layout_map" };
    ({ data: file, error } = await db().from("file_registry").select(columns).eq("tenant_id", tenantId).eq("id", fileId).maybeSingle());
    if (error) throw new Error(`Could not load the file: ${error.message}`);
  }
  if (!file || !file.raw_extracted_at) return { outcome: "not_applicable", reason: "its raw rows are not sealed" };
  // A file that failed when it arrived is not read. One that failed while being read (it has a
  // parser) is read again: its layout may have been fixed or reassigned since.
  if (file.status === "failed" && file.parse_block !== "no_layout_map" && !file.parser_id) return { outcome: "not_applicable", reason: "the file failed when it arrived" };
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
  // LA-4.5: the unknown-status gate. Only rows whose carrier word has an approved mapping go further.
  // A new-business file is gated too, with its own words: "Incomplete" there is not "Incomplete" in a policy file.
  const gate = isPolicyFeed(file.file_type) ? await applyStatusGate(tenantId, fileId, file.carrier_id, file.file_type, resolved.map, result.rows) : null;
  const parsedAt = new Date().toISOString();
  const recorded = { ...parser, parsed_at: parsedAt, parsed_row_count: result.rows.length, ...(gate?.available ? { held_row_count: gate.heldRows } : {}) };
  await db().from("file_registry").update(movesStatus ? { ...recorded, status: "parsed" } : recorded).eq("tenant_id", tenantId).eq("id", fileId);
  return { outcome: "parsed", mapId: resolved.map.id, version: resolved.map.version, rows: result.rows.length, findings: result.findings.length + (gate?.heldRows ? 1 : 0), result, passed: gate?.available ? gate.passed : result.rows, heldRows: gate?.heldRows ?? 0 };
}

type Gate = { available: boolean; passed: TypedRow[]; heldRows: number };

/**
 * Holds back every row whose carrier word is not (yet) mapped, queues each such word once per agency
 * with its row count, records it for the parser guardian, and tells the agency about new words.
 * Before 20261008130000 there is no gate and every row passes, as in LA-4.3.
 */
async function applyStatusGate(tenantId: string, fileId: string, carrierId: string, fileType: CarrierFileType, map: LayoutMap, rows: TypedRow[]): Promise<Gate> {
  const { data: mappings, error } = await db().from("carrier_status_map").select("carrier_status_raw, status_normalized").eq("carrier_id", carrierId).eq("file_type", fileType).not("approved_at", "is", null);
  if (error) {
    if (isSchemaGap(error)) return { available: false, passed: rows, heldRows: 0 };
    throw new Error(`Could not read the status map: ${error.message}`);
  }
  const statusMap = new Map<string, NormalizedStatus>((mappings ?? []).map((row: Loose) => [row.carrier_status_raw as string, row.status_normalized as NormalizedStatus]));
  const gate = gateStatuses(rows, statusMap);
  const { data: queued, error: queueError } = await db().rpc("record_unmapped_statuses", { p_tenant_id: tenantId, p_file_id: fileId, p_carrier_id: carrierId, p_file_type: fileType, p_counts: gate.held });
  if (queueError) throw new Error(`The unmapped statuses could not be queued: ${queueError.message}`);
  if (gate.held.length) {
    await writeFindings(tenantId, fileId, map, [{
      findingType: "unmapped_status",
      severity: "blocking",
      reasoning: `${gate.heldRows} ${gate.heldRows === 1 ? "row is" : "rows are"} held: ${gate.held.length === 1 ? "this carrier status is" : "these carrier statuses are"} not mapped yet — ${gate.held.slice(0, 8).map((item) => `${shownWord(item.raw)} (${item.rows})`).join(", ")}.`,
      payload: { held: gate.held },
    }]);
    const fresh = ((queued ?? []) as Array<{ id: string; raw: string; new: boolean }>).filter((entry) => entry.new);
    if (fresh.length) await notifyUnmappedStatuses(tenantId, carrierId, fresh).catch((failure) => console.error("[status-gate] the agency could not be told:", failure));
  }
  return { available: true, passed: gate.passed, heldRows: gate.heldRows };
}

/** Tells the agency's owners and bookkeepers, once per new word, by email; the Carrier files page shows it too. */
async function notifyUnmappedStatuses(tenantId: string, carrierId: string, entries: Array<{ id: string; raw: string }>) {
  const [{ data: carrier }, { data: people }] = await Promise.all([
    db().from("carriers").select("name").eq("id", carrierId).maybeSingle(),
    db().from("tenant_users").select("user_id, role, users!inner(email, status)").eq("tenant_id", tenantId).in("role", ["owner", "bookkeeper"]).eq("users.status", "active"),
  ]);
  const name = carrier?.name ?? "A carrier";
  const words = entries.map((entry) => shownWord(entry.raw)).join(", ");
  const text = `${name} sent ${entries.length === 1 ? "a policy status" : "policy statuses"} Insurvas has not seen before: ${words}.\n\nThe policies with ${entries.length === 1 ? "this status are" : "these statuses are"} kept and held back until the status is mapped, so nothing is guessed. They are read automatically once it is.\n\nCarrier files: /app/carrier-files`;
  const html = `<p>${name} sent ${entries.length === 1 ? "a policy status" : "policy statuses"} Insurvas has not seen before: <strong>${words.replace(/</g, "&lt;")}</strong>.</p><p>The policies with ${entries.length === 1 ? "this status are" : "these statuses are"} kept and held back until the status is mapped, so nothing is guessed. They are read automatically once it is.</p>`;
  for (const person of (people ?? []) as Array<{ user_id: string; users: { email: string } }>) {
    await sendEmail({ to: person.users.email, subject: `${name}: a policy status needs mapping`, text, html, templateKey: "carrier_files.unmapped_status", userId: person.user_id, tenantId, dedupeKey: `unmapped_status:${entries.map((entry) => entry.id).join(",")}:${person.user_id}` });
  }
  await db().from("unmapped_status_queue").update({ notified_at: new Date().toISOString() }).eq("tenant_id", tenantId).in("id", entries.map((entry) => entry.id));
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
  // LA-4.6 / LA-4.12: a policy or commission file parsed but never derived (a stage failed half way) is read again. Before
  // 20261008140000 there is no derived_at column, and nothing to derive.
  const underived = await db().from("file_registry").select("id, tenant_id").eq("status", "parsed").in("file_type", ["policies", "new_business", "commissions"]).is("derived_at", null).order("received_at").limit(limit);
  const retry = underived.error ? [] : (underived.data ?? []);
  for (const file of [...(fresh.data ?? []), ...(blocked.data ?? []), ...retry] as Array<{ id: string; tenant_id: string }>) {
    try {
      const result = await parseCarrierFile(file.tenant_id, file.id);
      if (result.outcome === "parsed") { outcome.parsed++; await deriveFile(file.tenant_id, file.id, result); }
      else if (result.outcome === "failed") outcome.failed++;
      else if (result.outcome === "no_layout_map") outcome.waiting++;
      else if (result.outcome === "pending_schema") return { ...outcome, available: false };
    } catch (failure) {
      outcome.errors.push(`${file.id}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  return outcome;
}

/**
 * LA-4.6: after a parse, the stages a reprocess would run (snapshots, then the change log), for the
 * rows that passed the status gate. A failure leaves derived_at empty for the sweep to retry.
 */
export async function deriveFile(tenantId: string, fileId: string, outcome: Extract<ParseOutcome, { outcome: "parsed" }>): Promise<void> {
  const { data: file, error } = await db().from("file_registry").select("id, carrier_id, file_type, file_date, parser_version, row_count").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error || !file) throw new Error(`Could not load the file to derive: ${error?.message ?? "not found"}`);
  await runStages(tenantId, { id: file.id, carrierId: file.carrier_id, fileType: file.file_type, fileDate: file.file_date, parserVersion: file.parser_version, rowCount: file.row_count }, { parserVersion: outcome.version, typedRows: outcome.passed, fatal: null });
}

/** For after() in a door: read the rows, then parse them; never fails the request. */
export async function processFileQuietly(tenantId: string, fileId: string, extract: (tenantId: string, fileId: string) => Promise<unknown>): Promise<void> {
  try {
    await extract(tenantId, fileId);
    const outcome = await parseCarrierFile(tenantId, fileId);
    if (outcome.outcome === "parsed") await deriveFile(tenantId, fileId, outcome);
  } catch (error) {
    console.error(`[parser] ${fileId} failed; the next sweep retries:`, error);
  }
}
