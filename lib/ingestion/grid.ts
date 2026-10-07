/**
 * LA-4.2 (Notion sprint) · a spreadsheet as a grid of cells, and its raw rows.
 *
 * The raw layer keeps every row exactly as it arrived (Module 4 doc §4, Layer 1): nothing filtered,
 * nothing trimmed, nothing coerced. So this reader, unlike the contact importer's, keeps blank lines
 * and keeps each line's physical position — "row 14" is the fourteenth line of the source.
 *
 *   grid      every line of the file, every cell as text
 *   header    the row whose cells name the columns (chosen here until LA-4.3's layout maps say)
 *   preamble  every line above the header — a title, an agent number — kept, not dropped
 *   rows      every line below it: { rowNumber, payload } with the headers VERBATIM as keys and ""
 *             for a blank cell. A blank or repeated header still gets a unique key, and raw_columns
 *             records which column letter each key came from, so the grid can be rebuilt exactly.
 *
 * Pure; relative imports only.
 */

/** Every line of a CSV, blank ones included, each cell exactly as written (quotes resolved). */
export function parseCsvGrid(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell); cell = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (quoted) throw new Error("The file has a quoted cell that never closes, so its rows cannot be told apart.");
  // The newline that ends the last line does not start another row.
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "A", "B", … "Z", "AA", … for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function filled(row: string[]): number {
  return row.reduce((count, value) => count + (value.trim() !== "" ? 1 : 0), 0);
}

/**
 * The header row (1-based) when no layout map says otherwise: among the first 25 lines, the first
 * one as wide as the widest. A title line ("Commission Statement — October") is narrower than the
 * header under it, so it is passed over. LA-4.3's maps replace this guess with header_row_index.
 */
export function detectHeaderRow(grid: string[][]): number | null {
  const head = grid.slice(0, 25);
  const widest = Math.max(0, ...head.map(filled));
  if (widest < 2) return null;
  const index = head.findIndex((row) => filled(row) === widest);
  return index >= 0 ? index + 1 : null;
}

export type RawColumn = { column: string; header: string; key: string };
export type RawRow = { rowNumber: number; payload: Record<string, string> };
export type RawExtraction = { headerRow: number; columns: RawColumn[]; preamble: string[][]; rows: RawRow[] };

/**
 * Splits a grid at its header row into the file's columns, its preamble and its raw rows. Every row
 * below the header becomes a raw row — blank ones too — with one key per column, so a cell in a
 * column past the header's width still has somewhere to go.
 */
export function rawRowsFromGrid(grid: string[][], headerRow: number): RawExtraction {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > grid.length) throw new Error("The header row is outside the file.");
  const header = grid[headerRow - 1];
  const width = Math.max(header.length, ...grid.slice(headerRow).map((row) => row.length));
  const used = new Set<string>();
  const columns: RawColumn[] = [];
  for (let index = 0; index < width; index++) {
    const column = columnLetter(index);
    const text = header[index] ?? "";
    let key = text.trim() === "" ? `(column ${column})` : text;
    if (used.has(key)) key = `${text} (column ${column})`;
    used.add(key);
    columns.push({ column, header: text, key });
  }
  const rows: RawRow[] = grid.slice(headerRow).map((cells, offset) => {
    const payload: Record<string, string> = {};
    columns.forEach((column, index) => { payload[column.key] = cells[index] ?? ""; });
    return { rowNumber: headerRow + offset + 1, payload };
  });
  return { headerRow, columns, preamble: grid.slice(0, headerRow - 1), rows };
}

/**
 * The grid back from what the raw layer keeps (preamble, columns, rows) — the round trip the
 * acceptance asks for. Trailing cells a line did not have come back as "".
 */
export function gridFromRaw(extraction: Pick<RawExtraction, "preamble" | "columns" | "rows">): string[][] {
  return [
    ...extraction.preamble,
    extraction.columns.map((column) => column.header),
    ...extraction.rows.map((row) => extraction.columns.map((column) => row.payload[column.key] ?? "")),
  ];
}
