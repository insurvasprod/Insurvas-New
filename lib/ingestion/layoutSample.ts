import "server-only";

import { readXlsxSheets } from "@/lib/agentTemplates/xlsx";

import type { CarrierFileKind, CarrierFileType } from "./constants";
import { chooseSheet, parseCsvGrid } from "./grid";
import { draftFromGrid, draftPdfTables, type LayoutDraft } from "./layoutDraft";
import { LayoutMapError } from "./layoutAdmin";
import { pdfGrid, type PdfLayout } from "./pdfLayout";
import { readPdfLines } from "./pdfText";
import { decodeCsvBytes } from "./rawLayer";
import { readSpreadsheetMl } from "./spreadsheetMl";

/**
 * A layout drafted from a sample file staff upload (owner request 2026-10-14). The file is read
 * exactly as an arriving carrier file is (the same CSV, Excel and PDF readers), drafted with
 * layoutDraft.ts, and returned with a few rows for the preview. Nothing is stored: the file is read
 * in memory and dropped; the draft is saved only when staff create the layout from it.
 */

/** Rows shown under the columns in the preview. */
const PREVIEW_ROWS = 5;
/** A statement rarely has more tables worth offering. */
const MAX_TABLES = 8;

export type SampleTable = { title: string; rows: number; layout: PdfLayout; draft: LayoutDraft; preview: string[][] };

export type SampleRead = {
  kind: CarrierFileKind;
  /** A workbook's sheets (visible ones), and the one read. */
  sheets: string[];
  sheetName: string | null;
  draft: LayoutDraft;
  preview: string[][];
  /** A PDF's tables, the one drafted first; empty for a spreadsheet. */
  tables: SampleTable[];
};

export function sampleKind(filename: string): CarrierFileKind | null {
  const extension = filename.toLowerCase().split(".").pop();
  return extension === "csv" || extension === "xlsx" || extension === "xls" || extension === "pdf" ? extension : null;
}

function previewOf(grid: string[][], headerRow: number): string[][] {
  return grid.slice(headerRow).filter((row) => row.some((cell) => cell.trim() !== "")).slice(0, PREVIEW_ROWS);
}

/** Reads a sample file into a draft layout of one file type. `sheet` picks a workbook's sheet. */
export async function readSampleFile(bytes: Uint8Array, filename: string, fileType: CarrierFileType, sheet: string | null = null): Promise<SampleRead> {
  const kind = sampleKind(filename);
  if (!kind) throw new LayoutMapError("Choose a CSV, Excel (.xlsx or .xls) or PDF file.", 400);

  if (kind === "pdf") {
    const lines = await readPdfLines(bytes);
    if (!lines.length) throw new LayoutMapError("This PDF has no text: it looks scanned (an image of a page), which can't be read.", 422);
    const tables: SampleTable[] = draftPdfTables(lines).slice(0, MAX_TABLES).flatMap((table) => {
      const grid = pdfGrid(lines, table.layout);
      const draft = draftFromGrid(grid, fileType, { headerRow: 1, letters: false });
      return draft ? [{ title: table.title, rows: table.rows, layout: table.layout, draft, preview: previewOf(grid, 1) }] : [];
    });
    if (!tables.length) throw new LayoutMapError("No table was found in this PDF: no line of column titles has rows under it.", 422);
    return { kind, sheets: [], sheetName: null, draft: tables[0].draft, preview: tables[0].preview, tables };
  }

  let grid: string[][];
  let sheets: string[] = [];
  let sheetName: string | null = null;
  try {
    if (kind === "csv") grid = parseCsvGrid(decodeCsvBytes(bytes));
    else {
      const book = kind === "xlsx"
        ? await readXlsxSheets(bytes.slice().buffer as ArrayBuffer)
        : readSpreadsheetMl(new TextDecoder("utf-8").decode(bytes)).map((one) => ({ name: one.name, hidden: false, grid: one.rows }));
      sheets = book.filter((one) => !one.hidden).map((one) => one.name);
      const chosen = chooseSheet(book, sheet) ?? book[0];
      sheetName = chosen?.name ?? null;
      grid = chosen?.grid ?? [];
    }
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw new LayoutMapError(kind === "xls" ? "This .xls can't be read: only Excel 2003 XML is. Save it as .xlsx or CSV and try again." : `This file can't be read: ${reason}`, 422);
  }
  const draft = draftFromGrid(grid, fileType);
  if (!draft) throw new LayoutMapError("No header row was found: no line in the file's first 25 has two or more filled cells.", 422);
  return { kind, sheets, sheetName, draft, preview: previewOf(grid, draft.headerRow), tables: [] };
}
