/**
 * A PDF statement's table, cut into columns by a PDF layout — the PDF counterpart of a fixed-width
 * file spec. Each column is named and has a left edge (in PDF points, measured from the carrier's
 * real statement); a text piece belongs to the last column whose edge is at or left of it. Header
 * text is never matched: carriers merge and misalign header labels, so positions are the contract.
 *
 *   rowStart       a line is a row when this column's text matches the pattern (Americo's policy
 *                  number, Corebridge's company code). Every other line — page headers, the column
 *                  titles, totals — is not a row.
 *   continuation   a carrier that writes a second line under a row (Americo's agent code and name)
 *                  names its columns here; the first such line after a row fills them.
 *   start / stop   the table begins after a line containing `start`, and ends at a line containing
 *                  any `stop` text (it begins again at the next `start`, so a table running onto
 *                  another page is read whole).
 *
 * The grid's first row is the column names; the raw layer and the layout map take it from there,
 * exactly as for a spreadsheet. Pure; relative imports only.
 */

export type PdfColumn = { name: string; x: number };
export type PdfLayout = {
  columns: PdfColumn[];
  rowStart: { column: string; pattern: string };
  continuation?: PdfColumn[];
  start?: string;
  stop?: string[];
};
export type PdfLineInput = { pieces: Array<{ x: number; text: string }>; text: string };

/** Text compared with its spacing ignored: a PDF splits "TRANSACTION DETAIL" into pieces at will. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** A piece this close to the left of an edge still belongs to that column (rounding in the PDF). */
const EDGE_TOLERANCE = 3;

/** What is wrong with a PDF layout, in sentences; empty when it can be used. */
export function pdfLayoutProblems(layout: unknown): string[] {
  const problems: string[] = [];
  const value = layout as Partial<PdfLayout> | null;
  if (!value || typeof value !== "object") return ["A PDF layout is an object with columns and a row start."];
  const columns = Array.isArray(value.columns) ? value.columns : [];
  if (columns.length < 2) problems.push("A PDF layout needs at least two columns.");
  const names = new Set<string>();
  let previous = -Infinity;
  for (const column of [...columns, ...(value.continuation ?? [])]) {
    if (!column || typeof column.name !== "string" || !column.name.trim()) { problems.push("Every column needs a name."); continue; }
    if (names.has(column.name)) problems.push(`"${column.name}" is named twice.`);
    names.add(column.name);
    if (typeof column.x !== "number" || !Number.isFinite(column.x)) problems.push(`"${column.name}" needs its left edge as a number.`);
  }
  for (const column of columns) {
    if (typeof column?.x === "number" && column.x <= previous) problems.push(`"${column.name}" must be right of the column before it.`);
    previous = column?.x ?? previous;
  }
  if (!value.rowStart || !columns.some((column) => column?.name === value.rowStart?.column)) problems.push("Say which column starts a row.");
  else {
    try { new RegExp(value.rowStart.pattern); } catch { problems.push("The row start pattern is not a valid pattern."); }
  }
  return problems;
}

function assign(pieces: PdfLineInput["pieces"], columns: PdfColumn[]): string[] {
  const cells: string[][] = columns.map(() => []);
  for (const piece of [...pieces].sort((a, b) => a.x - b.x)) {
    let index = 0;
    for (let i = 0; i < columns.length; i++) if (columns[i].x <= piece.x + EDGE_TOLERANCE) index = i;
    cells[index].push(piece.text.trim());
  }
  return cells.map((parts) => parts.filter(Boolean).join(" "));
}

/** The table as a grid: the column names, then one line per row. */
export function pdfGrid(lines: PdfLineInput[], layout: PdfLayout): string[][] {
  const columns = [...layout.columns].sort((a, b) => a.x - b.x);
  const extra = layout.continuation ? [...layout.continuation].sort((a, b) => a.x - b.x) : [];
  const startIndex = columns.findIndex((column) => column.name === layout.rowStart.column);
  const pattern = new RegExp(layout.rowStart.pattern);
  const header = [...columns.map((column) => column.name), ...extra.map((column) => column.name)];
  const rows: string[][] = [];
  let active = !layout.start;
  let open: { cells: string[]; continued: boolean } | null = null;
  for (const line of lines) {
    const said = flat(line.pieces.map((piece) => piece.text).join(" "));
    if (layout.start && said.includes(flat(layout.start))) { active = true; open = null; continue; }
    if (!active) continue;
    if (layout.stop?.some((text) => said.includes(flat(text)))) { active = false; open = null; continue; }
    const cells = assign(line.pieces, columns);
    if (pattern.test(cells[startIndex] ?? "")) {
      const row = [...cells, ...extra.map(() => "")];
      rows.push(row);
      open = { cells: row, continued: false };
    } else if (open && extra.length && !open.continued) {
      const more = assign(line.pieces, extra);
      // Only a line wholly inside the continuation columns continues the row.
      if (line.pieces.every((piece) => piece.x + EDGE_TOLERANCE >= extra[0].x)) {
        more.forEach((value, index) => { open!.cells[columns.length + index] = value; });
        open.continued = true;
      }
    }
  }
  return [header, ...rows];
}
