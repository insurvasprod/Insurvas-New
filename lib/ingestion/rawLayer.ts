import "server-only";

import { readXlsxSheets } from "@/lib/agentTemplates/xlsx";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { chooseSheet, detectHeaderRow, parseCsvGrid, rawRowsFromGrid } from "./grid";
import { pdfGrid, pdfLayoutProblems, type PdfLayout } from "./pdfLayout";
import { readPdfLines } from "./pdfText";
import { readSpreadsheetMl } from "./spreadsheetMl";
import type { ReprocessRow } from "./reprocess";
import { carrierFileStorage } from "./supabaseStorage";

/**
 * LA-4.2 (Notion sprint) · the raw layer, server side: reading a stored original into raw rows, the
 * sweep that finishes any file still waiting, reading the rows back, and reprocessing.
 *
 * Extraction is idempotent end to end: rows go in chunks that skip a row already there, and the file
 * is sealed only when the rows in the database number exactly what was read (finalize_raw_extraction).
 * A crash half way leaves the file unsealed, and the next sweep finishes it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

const CHUNK = 500;

export type ExtractOutcome =
  | { outcome: "extracted"; rowCount: number; headerRow: number; sheetName: string | null }
  | { outcome: "already"; rowCount: number }
  | { outcome: "failed"; reason: string }
  | { outcome: "not_applicable"; reason: string }
  | { outcome: "pending_schema" };

/** A carrier's CSV in whatever encoding it came: UTF-8 if it is valid UTF-8, else Windows-1252 — never a lossy replacement. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Records why a file's rows cannot be read. A received file also becomes failed, with the same
 * reason; a replaced file keeps its status and carries the reason in raw_error alone.
 */
async function markFailed(tenantId: string, fileId: string, reason: string) {
  const detail = reason.slice(0, 2000);
  await db().from("file_registry").update({ raw_error: detail }).eq("tenant_id", tenantId).eq("id", fileId).is("raw_extracted_at", null);
  await db().from("file_registry").update({ status: "failed", error_detail: detail }).eq("tenant_id", tenantId).eq("id", fileId).eq("status", "received");
}

/** Why a PDF waits: the same words as a spreadsheet waiting for its layout map. */
export const NO_PDF_LAYOUT_MESSAGE = "No PDF layout for this carrier and file type yet. The file is kept and will be read as soon as one is published.";

/**
 * What a carrier's published layout map says about reading this file — the sheet of a workbook, the
 * PDF layout of a statement — the agency's assignment and map first, as the parser resolves them.
 */
async function layoutForFile(tenantId: string, carrierId: string | null, fileType: string | null): Promise<{ sheetName: string | null; pdfLayout: PdfLayout | null }> {
  const none = { sheetName: null, pdfLayout: null };
  if (!carrierId || !fileType) return none;
  const { data: assignments } = await db().from("carrier_layout_assignment").select("tenant_id, layout_key").eq("carrier_id", carrierId).eq("file_type", fileType).or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  const rows = (assignments ?? []) as Array<{ tenant_id: string | null; layout_key: string }>;
  const assignment = rows.find((row) => row.tenant_id === tenantId) ?? rows.find((row) => row.tenant_id === null);
  if (!assignment) return none;
  const query = (columns: string) => db().from("carrier_layout_map").select(columns).eq("layout_key", assignment.layout_key).eq("file_type", fileType).eq("status", "published").or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  let read = await query("tenant_id, sheet_name, pdf_layout");
  if (read.error && isSchemaGap(read.error)) read = await query("tenant_id, sheet_name");
  const live = (read.data ?? []) as Array<{ tenant_id: string | null; sheet_name: string | null; pdf_layout?: unknown }>;
  const map = live.find((row) => row.tenant_id === tenantId) ?? live.find((row) => row.tenant_id === null);
  if (!map) return none;
  return { sheetName: map.sheet_name, pdfLayout: map.pdf_layout && pdfLayoutProblems(map.pdf_layout).length === 0 ? (map.pdf_layout as PdfLayout) : null };
}

/** Reads one registered spreadsheet into raw rows. Safe to call again; a sealed file is left alone. */
export async function extractRawRows(tenantId: string, fileId: string): Promise<ExtractOutcome> {
  const { data: file, error } = await db().from("file_registry").select("id, tenant_id, storage_path, file_kind, status, row_count, raw_extracted_at, raw_error, carrier_id, file_type").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return { outcome: "pending_schema" };
    throw new Error(`Could not load the file: ${error.message}`);
  }
  if (!file) return { outcome: "not_applicable", reason: "not found" };
  if (file.raw_extracted_at) return { outcome: "already", rowCount: file.row_count };
  if (!["csv", "xlsx", "xls", "pdf"].includes(file.file_kind)) return { outcome: "not_applicable", reason: "not a file kind that is read" };
  if (file.status === "failed") return { outcome: "not_applicable", reason: "the file failed when it arrived" };
  if (file.raw_error) return { outcome: "failed", reason: file.raw_error };

  let grid: string[][];
  let sheetName: string | null = null;
  // A PDF statement is a table only through its carrier's PDF layout: without one it waits, like a
  // spreadsheet without a layout map, and is read the moment one is published.
  const layout = await layoutForFile(tenantId, file.carrier_id, file.file_type);
  if (file.file_kind === "pdf" && !layout.pdfLayout) {
    await db().from("file_registry").update({ status: "failed", error_detail: NO_PDF_LAYOUT_MESSAGE, parse_block: "no_layout_map" }).eq("tenant_id", tenantId).eq("id", fileId).eq("status", "received");
    return { outcome: "not_applicable", reason: NO_PDF_LAYOUT_MESSAGE };
  }
  try {
    const bytes = await carrierFileStorage().get(file.storage_path);
    if (file.file_kind === "pdf") {
      const lines = await readPdfLines(bytes);
      if (!lines.length) throw new Error("the PDF has no text: it looks scanned (an image of a page), which isn't read. Ask the carrier for a text PDF, a CSV or an Excel file");
      grid = pdfGrid(lines, layout.pdfLayout!);
      if (grid.length < 2) throw new Error("no line of the PDF matched its layout's rows. The statement's layout may have changed");
    } else if (file.file_kind === "xlsx" || file.file_kind === "xls") {
      // A workbook's rows may be on any sheet: the layout's sheet, else the widest header (chooseSheet).
      const sheets = file.file_kind === "xlsx"
        ? await readXlsxSheets(bytes.slice().buffer as ArrayBuffer)
        : readSpreadsheetMl(new TextDecoder("utf-8").decode(bytes)).map((sheet) => ({ name: sheet.name, hidden: false, grid: sheet.rows }));
      const chosen = chooseSheet(sheets, layout.sheetName);
      sheetName = chosen?.name ?? sheets[0]?.name ?? null;
      grid = chosen?.grid ?? sheets[0]?.grid ?? [];
    } else {
      grid = parseCsvGrid(decodeCsvBytes(bytes));
    }
  } catch (failure) {
    const reason = `The file could not be read into rows: ${failure instanceof Error ? failure.message : String(failure)}`;
    await markFailed(tenantId, fileId, reason);
    return { outcome: "failed", reason };
  }

  const headerRow = detectHeaderRow(grid);
  if (!headerRow) {
    const reason = "The file has no header row: no line in its first 25 has two or more filled cells.";
    await markFailed(tenantId, fileId, reason);
    return { outcome: "failed", reason };
  }
  const extraction = rawRowsFromGrid(grid, headerRow);

  for (let start = 0; start < extraction.rows.length; start += CHUNK) {
    const chunk = extraction.rows.slice(start, start + CHUNK).map((row) => ({ row_number: row.rowNumber, payload: row.payload }));
    const { error: insertError } = await db().rpc("insert_raw_rows", { p_tenant_id: tenantId, p_file_id: fileId, p_rows: chunk });
    if (insertError) {
      if (isSchemaGap(insertError)) return { outcome: "pending_schema" };
      throw new Error(`Raw rows could not be stored: ${insertError.message}`);
    }
  }
  const { error: sealError } = await db().rpc("finalize_raw_extraction", {
    p_tenant_id: tenantId,
    p_file_id: fileId,
    p_row_count: extraction.rows.length,
    p_sheet_name: sheetName,
    p_header_row: extraction.headerRow,
    p_columns: extraction.columns,
    p_preamble: extraction.preamble,
  });
  if (sealError) {
    if (isSchemaGap(sealError)) return { outcome: "pending_schema" };
    throw new Error(`The file's raw rows could not be sealed: ${sealError.message}`);
  }
  return { outcome: "extracted", rowCount: extraction.rows.length, headerRow: extraction.headerRow, sheetName };
}

/** For after() in a door: never fails the request that registered the file. */
export async function extractRawRowsQuietly(tenantId: string, fileId: string): Promise<void> {
  try {
    await extractRawRows(tenantId, fileId);
  } catch (error) {
    console.error(`[raw-layer] extraction of ${fileId} failed; the next sweep retries:`, error);
  }
}

export type SweepOutcome = { available: boolean; extracted: number; failed: number; errors: string[] };

/** Finishes every spreadsheet still waiting for its rows, oldest first. Run by the poll. */
export async function extractPendingRawRows(limit = 20): Promise<SweepOutcome> {
  const outcome: SweepOutcome = { available: true, extracted: 0, failed: 0, errors: [] };
  const { data, error } = await db()
    .from("file_registry")
    .select("id, tenant_id")
    .is("raw_extracted_at", null)
    .is("raw_error", null)
    .in("file_kind", ["csv", "xlsx", "xls", "pdf"])
    .in("status", ["received", "superseded"])
    .order("received_at")
    .limit(limit);
  if (error) {
    if (isSchemaGap(error)) return { ...outcome, available: false };
    throw new Error(`Could not list files waiting for their rows: ${error.message}`);
  }
  for (const file of (data ?? []) as Array<{ id: string; tenant_id: string }>) {
    try {
      const result = await extractRawRows(file.tenant_id, file.id);
      if (result.outcome === "extracted") outcome.extracted++;
      else if (result.outcome === "failed") outcome.failed++;
      else if (result.outcome === "pending_schema") return { ...outcome, available: false };
    } catch (failure) {
      outcome.errors.push(`${file.id}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  return outcome;
}

/** One file's raw rows, in source order, read in pages (a 10,000-row file is ten reads). */
export async function readRawRows(tenantId: string, fileId: string): Promise<ReprocessRow[]> {
  const rows: ReprocessRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("raw_rows").select("row_number, payload").eq("tenant_id", tenantId).eq("file_id", fileId).order("row_number").range(from, from + 999);
    if (error) throw new Error(`Could not read the raw rows: ${error.message}`);
    for (const row of data ?? []) rows.push({ rowNumber: row.row_number, payload: row.payload });
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}
