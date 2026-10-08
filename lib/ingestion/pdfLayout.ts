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
 *   total          LA-4.4's balance gate: the statement's own total — the amount right after this
 *                  label — becomes a total row (PDF_TOTAL_MARKER) in the amount column, and the layout
 *                  map then requires the lines to add up to it exactly, or nothing is read. A layout
 *                  that names a total and a statement without it fails: the lines cannot be checked.
 *   balance        opening + activity = closing, as the statement states them, checked on its own;
 *                  the activity must equal the total too.
 *
 * An amount is found by its label: the first line (after `after`, when given) containing the label,
 * spacing ignored, and the `nth` amount written after it — "(1,758.38)", "$0.00", "13,235.56-".
 * The grid's first row is the column names; the raw layer and the layout map take it from there,
 * exactly as for a spreadsheet. Pure; relative imports only.
 */

export type PdfColumn = { name: string; x: number };
/** Where a stated amount is: the label before it, the line to look after, which amount after it. */
export type PdfAmount = { label: string; after?: string; nth?: number };
export type PdfLayout = {
  columns: PdfColumn[];
  rowStart: { column: string; pattern: string };
  continuation?: PdfColumn[];
  start?: string;
  stop?: string[];
  total?: PdfAmount & { column: string };
  balance?: { opening: PdfAmount; activity: PdfAmount; closing: PdfAmount };
};
export type PdfLineInput = { pieces: Array<{ x: number; text: string }>; text: string };

/** The first cell of the statement's total row, which the layout map reads as its stated total. */
export const PDF_TOTAL_MARKER = "(statement total)";

/** Text compared with its spacing ignored: a PDF splits "TRANSACTION DETAIL" into pieces at will. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

const MONEY = /\(?-?\$?\d[\d,]*\.\d{2}\)?-?/g;

/** "(1,758.38)" → -175838, by string alone: no float ever holds money. Null when it is not an amount. */
export function moneyCents(text: string): number | null {
  const value = text.trim();
  const match = /^(\()?(-)?\$?(\d[\d,]*)\.(\d{2})(\))?(-)?$/.exec(value);
  if (!match) return null;
  const cents = Number(match[3].replaceAll(",", "") + match[4]);
  if (!Number.isSafeInteger(cents)) return null;
  return (match[1] && match[5]) || match[2] || match[6] ? -cents : cents;
}

/** "−$1,758.38" from cents, for the reasons a file fails with. */
export function dollars(cents: number): string {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "−" : ""}$${Number(digits.slice(0, -2)).toLocaleString("en-US")}.${digits.slice(-2)}`;
}

/** A stated amount, found by its label; null when the statement doesn't have it. */
export function findAmount(lines: PdfLineInput[], where: PdfAmount): { text: string; cents: number } | null {
  let looking = !where.after;
  for (const line of lines) {
    const said = flat(line.pieces.map((piece) => piece.text).join(" "));
    if (!looking) {
      if (said.includes(flat(where.after!))) looking = true;
      continue;
    }
    const at = said.indexOf(flat(where.label));
    if (at < 0) continue;
    const amounts = said.slice(at + flat(where.label).length).match(MONEY) ?? [];
    const text = amounts[where.nth ?? 0];
    const cents = text === undefined ? null : moneyCents(text);
    return text !== undefined && cents !== null ? { text, cents } : null;
  }
  return null;
}

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
  const labelled = (amount: unknown) => Boolean(amount && typeof (amount as PdfAmount).label === "string" && (amount as PdfAmount).label.trim());
  if (value.total !== undefined) {
    if (!labelled(value.total)) problems.push("The statement total needs the label printed before it.");
    if (!columns.some((column) => column?.name === value.total?.column)) problems.push("Say which column the statement total is the total of.");
  }
  if (value.balance !== undefined && !(labelled(value.balance?.opening) && labelled(value.balance?.activity) && labelled(value.balance?.closing))) {
    problems.push("The balance check needs the labels of the opening balance, the activity and the closing balance.");
  }
  return problems;
}

/** LA-4.4: what is wrong with the statement's own arithmetic; null when it holds. Throws nothing. */
export function statementProblem(lines: PdfLineInput[], layout: PdfLayout): string | null {
  const total = layout.total ? findAmount(lines, layout.total) : null;
  if (layout.total && !total) return `the statement's total ("${layout.total.label}") was not found, so its lines cannot be checked`;
  if (!layout.balance) return null;
  const opening = findAmount(lines, layout.balance.opening);
  const activity = findAmount(lines, layout.balance.activity);
  const closing = findAmount(lines, layout.balance.closing);
  const absent = [[opening, layout.balance.opening], [activity, layout.balance.activity], [closing, layout.balance.closing]].filter(([found]) => !found).map(([, where]) => `"${(where as PdfAmount).label}"`);
  if (absent.length) return `the statement's balances (${absent.join(", ")}) were not found, so they cannot be checked`;
  if (opening!.cents + activity!.cents !== closing!.cents) {
    return `the statement doesn't add up: opening ${dollars(opening!.cents)} + activity ${dollars(activity!.cents)} = ${dollars(opening!.cents + activity!.cents)}, but it states a closing balance of ${dollars(closing!.cents)}, a difference of ${dollars(opening!.cents + activity!.cents - closing!.cents)}`;
  }
  if (total && total.cents !== activity!.cents) return `the statement's total ${dollars(total.cents)} is not its activity ${dollars(activity!.cents)}`;
  return null;
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
  // The statement's total, as a total row the layout map checks the lines against (LA-4.4).
  if (layout.total) {
    const total = findAmount(lines, layout.total);
    const at = header.indexOf(layout.total.column);
    if (total && at >= 0) {
      const row = header.map(() => "");
      row[0] = PDF_TOTAL_MARKER;
      row[at] = total.text;
      rows.push(row);
    }
  }
  return [header, ...rows];
}
