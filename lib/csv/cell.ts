/**
 * One CSV cell, for every export the product writes. Plain module: client downloads, server routes
 * and node tests all use it.
 *
 * Text starting with = + - @ (or a tab/CR) runs as a formula when the file is opened in Excel or
 * Sheets — a lead named "=HYPERLINK(...)" is enough (OWASP "CSV injection"). Such text gets a leading
 * apostrophe, which the spreadsheet shows as plain text. Only strings are guarded: a number stays a
 * number, so -12.5 is still -12.5 in the sheet.
 *
 * Two quoting styles, because each export keeps the one it had and a sheet already reading it sees
 * the same file: `csvCell` quotes every cell, `csvCellMinimal` only one holding a quote, comma or
 * line break. Both take one argument, so `.map(csvCell)` is safe.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function guarded(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return typeof value === "string" && FORMULA_START.test(text) ? `'${text}` : text;
}

const quoted = (text: string) => `"${text.replaceAll('"', '""')}"`;

export function csvCell(value: unknown): string {
  return quoted(guarded(value));
}

export function csvCellMinimal(value: unknown): string {
  const text = guarded(value);
  return /[",\r\n]/.test(text) ? quoted(text) : text;
}

/**
 * The importer's half, for a file the product exported and now reads back (an edited export): drops
 * the apostrophe the guard put in front of formula-like text. Anything else comes back unchanged.
 */
export function csvUnguard(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}
