/**
 * LA-2.2-1 · an Excel workbook turned into the SAME CSV text the importer already checks, so
 * mapping, validation, the scrub and the dedupe are unchanged. The lead importer reads workbooks in
 * the browser and sends only CSV (user decision: ExcelJS in the browser). Carrier statements
 * (LA-4.1) send the workbook itself; the server reads it with this same code, so the preview and
 * the import see identical lines.
 *
 * Pure: the conversion takes plain cell values (what ExcelJS hands back) and a number format per
 * cell, so it is tested without a workbook. `readXlsxAsCsv` is the thin wrapper that loads ExcelJS
 * on demand and feeds it through; it runs in the browser and on the server.
 */

/** A cell as ExcelJS reports it: a primitive, a Date, or one of its object shapes. */
export type XlsxCell = {
  value: unknown;
  /** The cell's number format, e.g. "00000" for a ZIP column that keeps its leading zeros. */
  numFmt?: string | null;
};

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

/** The ISO date the importer reads, for a date cell. Excel dates carry no zone, so UTC is exact. */
function isoDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
  const hasTime = date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds();
  return hasTime ? date.toISOString() : day;
}

function numberText(value: number, numFmt?: string | null) {
  if (!Number.isFinite(value)) return "";
  // A column formatted as zeros ("00000") shows leading zeros the stored number does not have — a
  // ZIP like 03001, which the importer must see as it appears in the sheet.
  const zeros = numFmt && /^0+$/.test(numFmt.trim()) ? numFmt.trim().length : 0;
  if (Number.isInteger(value)) {
    // A ten-digit phone stored as a number is exact up to 2^53; never exponent notation.
    const whole = value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
    return zeros ? whole.padStart(zeros, "0") : whole;
  }
  return String(value);
}

/** The text a cell contributes to the CSV. */
export function cellText(cell: XlsxCell | null | undefined): string {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return numberText(value, cell?.numFmt);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    // Rich text: the runs, joined.
    if (Array.isArray(object.richText)) return object.richText.map((run) => String((run as { text?: unknown }).text ?? "")).join("");
    // A formula: its last computed result, which is what the sheet shows.
    if ("formula" in object || "sharedFormula" in object) return cellText({ value: object.result, numFmt: cell?.numFmt });
    // A hyperlink: the text shown, else the link.
    if ("hyperlink" in object) return String(object.text ?? object.hyperlink ?? "");
    if ("text" in object) return String(object.text ?? "");
    if ("error" in object) return "";
  }
  return String(value);
}

function csvField(text: string) {
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows of cells to CSV text. The header row sets the width, trailing empty rows are dropped, and a
 * row of nothing but blanks inside the sheet is dropped too (Excel leaves them after deletions), so
 * the row count the importer reports is the sheet's.
 */
export function rowsToCsv(rows: Array<Array<XlsxCell | null | undefined>>): string {
  const all = rows.map((row) => (row ?? []).map((cell) => cellText(cell)));
  // A sheet whose table starts below row 1: the first row with anything in it is the header.
  const start = all.findIndex((row) => row.some((cell) => cell.trim()));
  const texts = start < 0 ? [] : all.slice(start);
  const header = texts[0] ?? [];
  let width = header.length;
  while (width > 0 && !header[width - 1]?.trim()) width--;
  const lines: string[] = [];
  for (const [index, row] of texts.entries()) {
    const cells = Array.from({ length: width }, (_, column) => row[column] ?? "");
    if (index > 0 && cells.every((cell) => !cell.trim())) continue;
    lines.push(cells.map(csvField).join(","));
  }
  return lines.join("\n");
}

export const XLSX_TYPES = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isXlsxFile(file: { name: string; type?: string }) {
  return /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

/**
 * Every worksheet of an .xlsx file as a grid of cell texts, in workbook order, for the carrier-file
 * raw layer: every line kept where it is (blank ones too) and every cell of the widest row, so a
 * title row above the header never narrows the table. Unlike rowsToCsv, which shapes a lead list for
 * the importer, nothing here is dropped or trimmed.
 */
export async function readXlsxSheets(buffer: ArrayBuffer): Promise<Array<{ name: string; hidden: boolean; grid: string[][] }>> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length) throw new Error("This workbook has no worksheet to import.");
  return workbook.worksheets.map((sheet) => {
    // The declared width can be narrower than the rows (a stale dimension tag): measure every row.
    let columns = Math.max(sheet.columnCount, sheet.actualColumnCount);
    sheet.eachRow({ includeEmpty: false }, (row) => { columns = Math.max(columns, row.cellCount); });
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let column = 1; column <= columns; column++) {
        const cell = row.getCell(column);
        cells.push(cellText({ value: cell.value, numFmt: cell.numFmt ?? null }));
      }
      grid[rowNumber - 1] = cells;
    });
    for (let index = 0; index < grid.length; index++) grid[index] ??= [];
    return { name: sheet.name, hidden: sheet.state !== "visible", grid };
  });
}
/**
 * The first visible worksheet of an .xlsx file, as CSV text. ExcelJS is loaded on demand, so a
 * browser importing a CSV never downloads it. The statement import also calls this on the server.
 */
export async function readXlsxAsCsv(buffer: ArrayBuffer): Promise<{ csv: string; sheetName: string; sheets: number }> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets.find((candidate) => candidate.state !== "hidden" && candidate.rowCount > 0) ?? workbook.worksheets[0];
  if (!sheet) throw new Error("This workbook has no worksheet to import.");
  const rows: XlsxCell[][] = [];
  const columns = Math.max(sheet.columnCount, sheet.actualColumnCount);
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: XlsxCell[] = [];
    for (let column = 1; column <= columns; column++) {
      const cell = row.getCell(column);
      cells.push({ value: cell.value, numFmt: cell.numFmt ?? null });
    }
    rows[rowNumber - 1] = cells;
  });
  // eachRow skips nothing with includeEmpty, but a sheet can start below row 1; fill the gaps.
  for (let index = 0; index < rows.length; index++) rows[index] ??= [];
  return { csv: rowsToCsv(rows), sheetName: sheet.name, sheets: workbook.worksheets.length };
}
