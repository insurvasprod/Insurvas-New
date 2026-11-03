import "server-only";

import { readXlsxSheets } from "@/lib/agentTemplates/xlsx";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import type { CarrierFileKind } from "./constants";
import { chooseSheet, detectHeaderRow, parseCsvGrid } from "./grid";
import { readPdfLines, type PdfLine } from "./pdfText";
import { decodeCsvBytes } from "./rawLayer";
import { readSpreadsheetMl } from "./spreadsheetMl";
import { StorageNotFoundError } from "./storage";
import { carrierFileStorage } from "./supabaseStorage";

/**
 * The whole carrier file, as the file has it (Owner request 2026-10-14): an agent sees every sheet
 * and every line of a spreadsheet — title lines above the header too — and every line of a PDF's
 * text, inside the software, without downloading it. Read from the stored original with the same
 * readers the raw layer uses, so what is shown is what was read. Writes nothing.
 *
 * Every read filters tenant_id: the service role has no RLS predicate.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export type OriginalSheet = { name: string; hidden: boolean; grid: string[][] };

/** A stored spreadsheet's sheets, read with the raw layer's readers (a CSV is one sheet with no name). */
export async function readOriginalSheets(kind: CarrierFileKind, bytes: Uint8Array): Promise<OriginalSheet[]> {
  if (kind === "csv") return [{ name: "", hidden: false, grid: parseCsvGrid(decodeCsvBytes(bytes)) }];
  if (kind === "xlsx") return readXlsxSheets(bytes.slice().buffer as ArrayBuffer);
  if (kind === "xls") return readSpreadsheetMl(new TextDecoder("utf-8").decode(bytes)).map((sheet) => ({ name: sheet.name, hidden: false, grid: sheet.rows }));
  throw new Error("Only a spreadsheet has sheets.");
}

export type WholeFile = {
  id: string;
  name: string;
  kind: CarrierFileKind | null;
  /** The sheet the rows were read from, and the line the layout read as the header (once read). */
  sheetRead: string | null;
  headerRow: number | null;
  /** Spreadsheets: every sheet. PDFs: every line of text. Null when the original could not be read. */
  sheets: OriginalSheet[] | null;
  pdfLines: PdfLine[] | null;
  /** Why the original could not be shown, in words. */
  problem: string | null;
};

export async function loadWholeFile(tenantId: string, fileId: string): Promise<WholeFile | null> {
  const { data: file, error } = await db().from("file_registry").select("id, storage_path, original_filename, file_kind, sheet_name, raw_header_row").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!file || !String(file.storage_path).startsWith(`${tenantId}/`)) return null;
  const kind = file.file_kind as CarrierFileKind | null;
  const whole: WholeFile = { id: file.id, name: file.original_filename, kind, sheetRead: file.sheet_name ?? null, headerRow: file.raw_header_row ?? null, sheets: null, pdfLines: null, problem: null };
  if (!kind) return { ...whole, problem: "This file is not a CSV, Excel file or PDF, so it can't be shown here. Download it to open it." };
  try {
    const bytes = await carrierFileStorage().get(file.storage_path);
    if (kind === "pdf") whole.pdfLines = await readPdfLines(bytes);
    else whole.sheets = await readOriginalSheets(kind, bytes);
  } catch (failure) {
    whole.problem = failure instanceof StorageNotFoundError ? "The original file is no longer in storage." : `The file could not be opened: ${failure instanceof Error ? failure.message : String(failure)}`;
  }
  return whole;
}

/** The sheet shown first: the one asked for, else the one the rows were read from, else the one they would be. */
export function shownSheet(sheets: OriginalSheet[], asked: string | null | undefined, sheetRead: string | null): OriginalSheet | null {
  return (asked != null ? sheets.find((sheet) => sheet.name === asked) : undefined)
    ?? (sheetRead ? sheets.find((sheet) => sheet.name === sheetRead) : undefined)
    ?? chooseSheet(sheets, null)
    ?? sheets[0]
    ?? null;
}

/** The header line to mark: the one the layout read, on the sheet it read; else the likely one. */
export function headerLine(sheet: OriginalSheet, sheets: OriginalSheet[], sheetRead: string | null, headerRow: number | null): { line: number; read: boolean } | null {
  const isRead = sheets.length === 1 || (sheetRead !== null && sheet.name === sheetRead);
  if (isRead && headerRow) return { line: headerRow, read: true };
  const likely = detectHeaderRow(sheet.grid);
  return likely ? { line: likely, read: false } : null;
}
