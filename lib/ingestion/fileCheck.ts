/**
 * The file checker (Owner request 2026-10-14): which published layout a carrier file looks like,
 * from its column headers (a spreadsheet) or its text (a PDF).
 *
 * The Notion spec LA-4.1 attributes an automatic file (bucket folder path, email sender and file
 * name) by its path WITHOUT opening it. That stays the rule: a file whose carrier could not be told
 * that way is stored as failed, and this check only SUGGESTS who sent it. A person CONFIRMS the
 * carrier, type and date before anything is read; nothing here attributes a file by itself.
 *
 *   spreadsheet  each sheet's header row (grid.ts detectHeaderRow) against each layout's listed
 *                source columns (every column of a carrier's file is listed now; kept ones too),
 *                trimmed and compared without case. The fit is the share of the file's non-empty
 *                headers the layout lists; a layout whose REQUIRED columns are not all there ranks
 *                below one whose are.
 *   pdf          the layout's `start` text and its column names found in the PDF's lines, and
 *                whether the layout cuts any rows out of it (pdfLayout.ts pdfGrid).
 *
 * Carriers that share a layout are told apart by the file name (path.ts prefillFromFilename).
 * Pure; relative imports only.
 */
import type { CarrierFileType } from "./constants.ts";
import { pdfGrid, type PdfLayout, type PdfLineInput } from "./pdfLayout.ts";
import { prefillFromFilename, type CarrierChoice } from "./path.ts";

export type CheckLayoutEntry = { sourceColumn: string; required: boolean };

/** One published layout, as the check sees it. */
export type CheckLayout = {
  layoutKey: string;
  name: string;
  fileType: CarrierFileType;
  entries: CheckLayoutEntry[];
  /** Set for a PDF layout; a spreadsheet layout has none. */
  pdfLayout: PdfLayout | null;
  /** The carriers whose files of this type this layout reads. */
  carriers: Array<{ id: string; name: string }>;
};

export type CheckFile =
  | { kind: "sheets"; sheets: Array<{ name: string | null; headers: string[] }> }
  | { kind: "pdf"; lines: PdfLineInput[] };

export type LayoutMatch = {
  layoutKey: string;
  name: string;
  fileType: CarrierFileType;
  carriers: Array<{ id: string; name: string }>;
  /** 0–100. */
  fit: number;
  /** Spreadsheet: the file's headers the layout lists, of how many. PDF: the layout's names found, of how many. */
  matched: number;
  total: number;
  /** The required source columns the file does not have (spreadsheets). */
  missingRequired: string[];
  /** The sheet that fit best (workbooks). */
  sheetName: string | null;
  /** PDF: rows the layout cut out of the file. */
  pdfRows: number | null;
  /** The carrier to suggest: the file name's, when it is one of the layout's; else the layout's only carrier. */
  carrierId: string | null;
  /** Ranking score (0–1); fit with a penalty for missing required columns. */
  score: number;
};

export type FileCheckResult = {
  matches: LayoutMatch[];
  /** What the file name says (path.ts), for the date and to choose among carriers. */
  fromName: { carrierId: string | null; fileType: CarrierFileType | null; fileDate: string | null };
};

const key = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

function sheetFit(headers: string[], layout: CheckLayout) {
  const fileHeaders = [...new Set(headers.map(key).filter(Boolean))];
  // A source column is read as the parser reads it (layout.ts parseWithMap): "=annual" is a fixed
  // value no file has, and "Status + Reason" is two columns joined, each of which the file must have.
  const parts = (source: string) => (source.startsWith("=") && source.length > 1 ? [] : source.split(" + ").map(key).filter(Boolean));
  const listed = new Set(layout.entries.flatMap((entry) => parts(entry.sourceColumn)));
  const have = new Set(fileHeaders);
  const matched = fileHeaders.filter((header) => listed.has(header)).length;
  const missingRequired = [...new Set(layout.entries.filter((entry) => entry.required && !parts(entry.sourceColumn).every((part) => have.has(part))).map((entry) => entry.sourceColumn.trim()))];
  const share = fileHeaders.length ? matched / fileHeaders.length : 0;
  // How much of the layout the file covers breaks ties between a narrow and a wide layout.
  const coverage = listed.size ? matched / listed.size : 0;
  const score = share * 0.85 + coverage * 0.15 - (missingRequired.length ? 0.3 : 0);
  return { matched, total: fileHeaders.length, missingRequired, fit: Math.round(share * 100), score };
}

function pdfFit(lines: PdfLineInput[], layout: PdfLayout) {
  const text = lines.map((line) => key(line.pieces.map((piece) => piece.text).join(" "))).join("\n");
  const names = [...new Set([
    ...layout.columns.map((column) => column.name),
    ...(layout.sections?.parts ?? []).map((part) => part.start),
  ].map(key).filter(Boolean))];
  const found = names.filter((name) => text.includes(name)).length;
  const startFound = layout.start ? text.includes(key(layout.start)) : null;
  let rows = 0;
  try {
    rows = pdfGrid(lines, layout).length - 1;
  } catch {
    rows = 0;
  }
  const nameShare = names.length ? found / names.length : 0;
  // Cutting rows out of the file is the real test; the start line and the column names back it up.
  const fit = startFound === null ? nameShare * 0.4 + (rows > 0 ? 0.6 : 0) : (startFound ? 0.4 : 0) + nameShare * 0.2 + (rows > 0 ? 0.4 : 0);
  return { matched: found, total: names.length, fit: Math.round(fit * 100), score: fit, rows };
}

/**
 * Ranks the published layouts by how well the file fits them, best first (at most `limit`, and only
 * layouts with some fit). `carriers` is the library, for the file-name guess.
 */
export function checkFile(input: { file: CheckFile; layouts: CheckLayout[]; filename?: string | null; carriers?: CarrierChoice[]; limit?: number }): FileCheckResult {
  const prefill = input.filename ? prefillFromFilename(input.filename, input.carriers ?? []) : { carrierId: null, fileType: null, fileDate: null };
  const matches: LayoutMatch[] = [];
  for (const layout of input.layouts) {
    let base: Omit<LayoutMatch, "layoutKey" | "name" | "fileType" | "carriers" | "carrierId"> | null = null;
    if (input.file.kind === "pdf") {
      if (!layout.pdfLayout) continue;
      const fit = pdfFit(input.file.lines, layout.pdfLayout);
      base = { fit: fit.fit, matched: fit.matched, total: fit.total, missingRequired: [], sheetName: null, pdfRows: fit.rows, score: fit.score };
    } else {
      if (layout.pdfLayout) continue;
      for (const sheet of input.file.sheets) {
        const fit = sheetFit(sheet.headers, layout);
        if (!base || fit.score > base.score) base = { fit: fit.fit, matched: fit.matched, total: fit.total, missingRequired: fit.missingRequired, sheetName: sheet.name, pdfRows: null, score: fit.score };
      }
    }
    if (!base || base.matched === 0) continue;
    const named = prefill.carrierId ? layout.carriers.find((carrier) => carrier.id === prefill.carrierId) : undefined;
    const carrierId = named?.id ?? (layout.carriers.length === 1 ? layout.carriers[0].id : null);
    // The file name only breaks ties: its carrier among the layout's, and its file type.
    const nudge = (named ? 0.002 : 0) + (prefill.fileType && prefill.fileType === layout.fileType ? 0.001 : 0);
    matches.push({ layoutKey: layout.layoutKey, name: layout.name, fileType: layout.fileType, carriers: layout.carriers, carrierId, ...base, score: base.score + nudge });
  }
  matches.sort((a, b) => b.score - a.score || b.matched - a.matched || a.name.localeCompare(b.name));
  return { matches: matches.slice(0, input.limit ?? 5), fromName: prefill };
}

export type PublishedMapInput = {
  tenantId: string | null;
  layoutKey: string;
  name: string;
  fileType: CarrierFileType;
  version: number;
  pdfLayout: PdfLayout | null;
  entries: CheckLayoutEntry[];
};
export type AssignmentInput = { tenantId: string | null; carrierId: string; carrierName: string; fileType: CarrierFileType; layoutKey: string };

/**
 * The layouts an agency's files are read with, as the parser resolves them (layout.ts
 * chooseLayoutMap): for each layout, the agency's own published version, else the platform's; for
 * each carrier and file type, the agency's own assignment, else the platform's.
 */
export function layoutsFromRows(tenantId: string, maps: PublishedMapInput[], assignments: AssignmentInput[]): CheckLayout[] {
  const live = new Map<string, PublishedMapInput>();
  for (const map of maps) {
    const at = `${map.layoutKey}|${map.fileType}`;
    const held = live.get(at);
    const rank = (row: PublishedMapInput) => (row.tenantId === tenantId ? 1 : 0) * 1e6 + row.version;
    if ((map.tenantId === tenantId || map.tenantId === null) && (!held || rank(map) > rank(held))) live.set(at, map);
  }
  const chosen = new Map<string, AssignmentInput>();
  for (const row of assignments) {
    if (row.tenantId !== tenantId && row.tenantId !== null) continue;
    const at = `${row.carrierId}|${row.fileType}`;
    const held = chosen.get(at);
    if (!held || (held.tenantId === null && row.tenantId === tenantId)) chosen.set(at, row);
  }
  return [...live.values()].map((map) => ({
    layoutKey: map.layoutKey,
    name: map.name,
    fileType: map.fileType,
    entries: map.entries,
    pdfLayout: map.pdfLayout,
    carriers: [...chosen.values()]
      .filter((row) => row.layoutKey === map.layoutKey && row.fileType === map.fileType)
      .map((row) => ({ id: row.carrierId, name: row.carrierName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/**
 * Does another layout fit clearly better than the one the file was given? For a file read with a
 * carrier's layout that failed on a missing required column: the best match must cover every
 * required column, and fit at least 20 points better than the file's own layout.
 */
export function clearlyBetter(result: FileCheckResult, currentLayoutKey: string | null): LayoutMatch | null {
  const best = result.matches[0];
  if (!best || best.layoutKey === currentLayoutKey || best.missingRequired.length || best.fit < 60) return null;
  const own = result.matches.find((match) => match.layoutKey === currentLayoutKey);
  return !own || best.fit - own.fit >= 20 || own.missingRequired.length > 0 ? best : null;
}
