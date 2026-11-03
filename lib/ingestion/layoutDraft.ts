/**
 * A layout map drafted from a sample file (owner request 2026-10-14: "create it automatically" —
 * upload a carrier's file and get a draft with EVERY column in it, not only the ones the software
 * reads). Staff check the draft and publish it; nothing here publishes (LA-4.3: the guardian may
 * propose map entries as a draft for a human to approve, never publish them).
 *
 *   every column of the file becomes an entry, in the file's order:
 *     · a column whose header names one of our fields → that field, its type and transform guessed
 *       from the column's own values (a date's format, a rate written as a percent or a fraction,
 *       the carrier's words for an enum);
 *     · every other column → a KEPT entry: listed in the layout so the layout shows the whole file,
 *       read into no field, its value kept with the row as the carrier sent it (raw rows, and a
 *       policy snapshot's `extra`).
 *   a PDF statement gets a PDF layout too, found from its rows: the main table is the header line
 *     followed by the most lines shaped like rows; its columns are where those rows' values start,
 *     each named by the header text above it. A starting point staff check in the preview.
 *
 * Pure; relative imports only.
 */
import type { CarrierFileType } from "./constants.ts";
import { columnLetter, detectHeaderRow } from "./grid.ts";
import { guessTargetField, KEPT_PREFIX, REQUIRED_TARGETS, TARGET_FIELDS, type DataType, type LayoutEntry, type Transform } from "./layout.ts";
import { pdfGrid, type PdfLayout, type PdfLineInput } from "./pdfLayout.ts";

export { isKeptEntry, isKeptField, KEPT_PREFIX } from "./layout.ts";

/** A kept entry for one column (`kept_c` for column C): text, as sent, never required. */
export function keptEntry(sourceColumn: string, name: string): LayoutEntry {
  return { sourceColumn, targetField: `${KEPT_PREFIX}${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 61), dataType: "text", transform: "none", required: false, enumValues: null };
}

/** The next free kept target in a list of entries: kept_1, kept_2, … */
export function nextKeptField(entries: Array<Pick<LayoutEntry, "targetField">>): string {
  const used = new Set(entries.map((entry) => entry.targetField));
  for (let n = 1; ; n++) if (!used.has(`${KEPT_PREFIX}${n}`)) return `${KEPT_PREFIX}${n}`;
}

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A carrier's word → our enum value, compared with case, spaces and punctuation removed. A guess staff confirm. */
const ENUM_HINTS: Record<string, Record<string, string[]>> = {
  premium_mode: {
    monthly: ["m", "mo", "mon", "mth", "mthly", "monthly", "12", "pac", "monthlypac", "monthlyeft"],
    quarterly: ["q", "qtr", "qtrly", "quarterly", "4"],
    semiannual: ["s", "sa", "semi", "semiannual", "semiannually", "2"],
    annual: ["a", "an", "ann", "annual", "annually", "yearly", "1"],
  },
  payment_method: {
    bank_draft: ["eft", "ach", "pac", "bankdraft", "draft", "bank", "electronicfundstransfer"],
    direct_express: ["directexpress", "dx"],
    card: ["cc", "card", "creditcard", "debitcard"],
    direct_bill: ["directbill", "direct", "dirbill", "bill", "list", "listbill", "mail", "coupon", "check"],
  },
  entry_type: {
    // NEW COV ISS (Mutual of Omaha) and PAIDFR (American Amicable): owner-approved 2026-10-13.
    advance: ["adv", "advance", "advanced", "advancecommission", "newcoviss", "paidfr"],
    earned: ["earned", "asearned", "comm", "commission", "renewal", "ren", "firstyear", "fy"],
    // BFY REVERSAL (Mutual of Omaha): owner-approved 2026-10-13.
    chargeback: ["cb", "chbk", "chargeback", "chargebk", "chgbk", "bfyreversal"],
    reversal: ["rev", "reversal", "reverse", "reversed"],
    fee: ["fee", "fees"],
    override: ["ovr", "ovrd", "override", "overrides"],
    advance_interest: ["ai", "advint", "advanceinterest", "interest"],
    held: ["held", "hold"],
  },
  payee_level: {
    writing_agent: ["writing", "writingagent", "agent", "self", "personal"],
    upline: ["upline", "override", "ovr"],
  },
};

const DATE_SHAPES: Array<{ transform: Transform; test: RegExp }> = [
  { transform: "none", test: /^\d{4}-\d{2}-\d{2}/ },
  { transform: "mmddyyyy", test: /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/ },
  { transform: "mmddyy", test: /^\d{1,2}[/-]\d{1,2}[/-]\d{2}$/ },
  { transform: "yyyymmdd", test: /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/ },
  { transform: "mmddyyyy", test: /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2}$/ },
  { transform: "mmddyy", test: /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{2}$/ },
];

/** The transform that reads most of a column's values, for a field of one type. */
function guessTransform(dataType: DataType, values: string[]): Transform {
  switch (dataType) {
    case "date": {
      let best: Transform = "mmddyyyy";
      let bestCount = 0;
      for (const shape of DATE_SHAPES) {
        const count = values.filter((value) => shape.test.test(value)).length;
        if (count > bestCount) { best = shape.transform; bestCount = count; }
      }
      return best;
    }
    // Dollar signs, thousands commas and brackets are all read by strip_currency; a plain number too.
    case "int_cents": return "strip_currency";
    case "basis_points": {
      if (values.some((value) => value.includes("%"))) return "pct_to_bp";
      // 0.825 or .75000: a rate written as a fraction of one.
      const fractions = values.filter((value) => /^-?0?\.\d+$/.test(value)).length;
      return fractions > values.length / 2 ? "fraction_to_bp" : "pct_to_bp";
    }
    default: return "none";
  }
}

export type DraftColumn = {
  /** "A", "B", … for a spreadsheet; 1, 2, … for a PDF statement's table. */
  column: string;
  /** Its place in the file's rows (0-based), to line the preview up under it. */
  index: number;
  header: string;
  /** The first few values under it, for the preview. */
  samples: string[];
  /** The field it was read into, or null when it is kept as sent. */
  becomes: string | null;
};

export type LayoutDraft = {
  headerRow: number;
  columns: DraftColumn[];
  entries: LayoutEntry[];
  /** Fields a published map of this type must read that no column was matched to. */
  missingRequired: string[];
  /** For an enum field: the carrier's words seen that could not be matched to one of our values. */
  unmatchedWords: Array<{ field: string; words: string[] }>;
};

/**
 * A draft from a grid: the header row (detected as the raw layer detects it, unless given), then one
 * entry per column. Two columns that look like the same field: the first wins, the second is kept.
 */
export function draftFromGrid(grid: string[][], fileType: CarrierFileType, options: { headerRow?: number; letters?: boolean } = {}): LayoutDraft | null {
  const headerRow = options.headerRow ?? detectHeaderRow(grid);
  if (!headerRow) return null;
  const header = grid[headerRow - 1] ?? [];
  const body = grid.slice(headerRow).filter((row) => row.some((cell) => cell.trim() !== ""));
  const fields = new Map(TARGET_FIELDS[fileType].map((field) => [field.key, field]));
  const taken = new Set<string>();
  const columns: DraftColumn[] = [];
  const entries: LayoutEntry[] = [];
  const unmatchedWords: LayoutDraft["unmatchedWords"] = [];
  header.forEach((cell, index) => {
    const name = cell.trim() === "" ? "" : cell;
    if (!name) return; // A column with no header has nothing to map by; its values are kept in the raw rows all the same.
    const letter = options.letters === false ? String(index + 1) : columnLetter(index);
    const values = body.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    const guess = guessTargetField(fileType, name);
    const field = guess && !taken.has(guess) ? fields.get(guess) ?? null : null;
    if (!field) {
      entries.push(keptEntry(name, letter));
      columns.push({ column: letter, index, header: name, samples: values.slice(0, 3), becomes: null });
      return;
    }
    taken.add(field.key);
    let enumValues: Record<string, string> | null = null;
    if (field.dataType === "enum") {
      enumValues = {};
      const misses: string[] = [];
      for (const word of [...new Set(body.map((row) => (row[index] ?? "").trim()).filter(Boolean))].slice(0, 60)) {
        const hit = Object.entries(ENUM_HINTS[field.key] ?? {}).find(([, words]) => words.includes(key(word)))?.[0];
        if (hit && field.enumValues?.includes(hit)) enumValues[word] = hit;
        else misses.push(word);
      }
      if (misses.length) unmatchedWords.push({ field: field.key, words: misses });
    }
    entries.push({
      sourceColumn: name,
      targetField: field.key,
      dataType: field.dataType,
      transform: field.verbatim ? "none" : guessTransform(field.dataType, values.slice(0, 200)),
      required: REQUIRED_TARGETS[fileType].includes(field.key),
      enumValues,
    });
    columns.push({ column: letter, index, header: name, samples: values.slice(0, 3), becomes: field.key });
  });
  return { headerRow, columns, entries, missingRequired: REQUIRED_TARGETS[fileType].filter((field) => !taken.has(field)), unmatchedWords };
}

// ─── a PDF statement's tables ─────────────────────────────────────────────────────────────────

const MONEYISH = /^\(?-?\$?\d[\d,]*(\.\d+)?\)?-?%?$/;
const wordy = (text: string) => /[A-Za-z]/.test(text) && !MONEYISH.test(text.trim()) && (text.match(/\d/g) ?? []).length <= text.length / 3;
const hasDigits = (text: string) => /\d/.test(text);
const flat = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** A line of column titles: three or more short labels, every one of them words, not figures. */
function isTitleLine(line: PdfLineInput): boolean {
  const pieces = line.pieces.filter((piece) => piece.text.trim() && !/^_+$/.test(piece.text.trim()));
  return pieces.length >= 3 && pieces.every((piece) => wordy(piece.text) && piece.text.trim().length <= 32);
}

/** A row of a table: two or more pieces, at least one holding a figure. */
const isRowLine = (line: PdfLineInput) => line.pieces.length >= 2 && line.pieces.some((piece) => hasDigits(piece.text));

export type PdfTableDraft = {
  /** The title line, as printed: how staff tell the tables apart. */
  title: string;
  /** Index of the title line among the PDF's lines. */
  line: number;
  rows: number;
  layout: PdfLayout;
};

/** Pieces whose left edges are this close start in the same place. */
const SAME_EDGE = 3;
/** A title word further than this from every column of values is a column of its own (empty in this sample). */
const OWN_COLUMN = 32;

/**
 * Every table of a PDF statement as a draft PDF layout, the one with the most rows first. A table is a
 * title line (with the title line under it, when a carrier prints its titles on two lines) and the
 * row-shaped lines straight after it; the same titles again further on (the next page) carry on the
 * same table. Columns start where the rows' values start: values that never share a line are one
 * column (a right-aligned amount starts further left the longer it is). Each column is named by the
 * title words nearest it. The row start is the leftmost column every row fills, and needs a digit,
 * so a "TOTAL" or "SUB TOTAL" line is not a row. No total or balance: staff add the statement's own
 * arithmetic, as for any PDF layout.
 */
export function draftPdfTables(lines: Array<PdfLineInput & { page?: number }>): PdfTableDraft[] {
  const tables: PdfTableDraft[] = [];
  const seenTitles = new Set<string>();
  // Titles printed on two or three lines are one table's, not tables of their own.
  const titleLines = new Set<number>();
  for (let at = 0; at < lines.length; at++) {
    if (!isTitleLine(lines[at]) || titleLines.has(at)) continue;
    const title = lines[at].pieces.map((piece) => piece.text.trim()).join(" ");
    if (seenTitles.has(flat(title))) continue;
    let depth = 1;
    while (depth < 3 && at + depth < lines.length && isTitleLine(lines[at + depth])) titleLines.add(at + depth++);
    const titlePieces = lines.slice(at, at + depth).flatMap((line) => line.pieces);
    // The rows under these titles, and under the same titles wherever they are printed again.
    const rows: PdfLineInput[] = [];
    for (let from = at; from < lines.length; from++) {
      if (from !== at && flat(lines[from].pieces.map((piece) => piece.text.trim()).join(" ")) !== flat(title)) continue;
      let index = from + depth;
      let misses = 0;
      for (; index < lines.length && misses < 3; index++) {
        if (isTitleLine(lines[index])) break;
        if (isRowLine(lines[index])) { rows.push(lines[index]); misses = 0; } else misses++;
      }
    }
    if (!rows.length) continue;
    seenTitles.add(flat(title));
    // The table's own rows have its full width; a second line under a row, or a total, is narrower.
    const widest = Math.max(...rows.map((row) => row.pieces.length));
    const main = rows.filter((row) => row.pieces.length >= Math.ceil(widest * 0.6));

    // Columns of values: start edges grouped, then neighbours that never share a row merged.
    const edges = [...new Set(main.flatMap((row) => row.pieces.map((piece) => piece.x)))].sort((a, b) => a - b);
    let groups: Array<{ min: number; max: number }> = [];
    for (const x of edges) {
      const last = groups[groups.length - 1];
      if (last && x - last.max <= SAME_EDGE) last.max = x;
      else groups.push({ min: x, max: x });
    }
    const inGroup = (row: PdfLineInput, group: { min: number; max: number }) => row.pieces.some((piece) => piece.x >= group.min && piece.x <= group.max);
    for (let merged = true; merged && groups.length > 1;) {
      merged = false;
      for (let index = 0; index + 1 < groups.length; index++) {
        const [a, b] = [groups[index], groups[index + 1]];
        if (!main.some((row) => inGroup(row, a) && inGroup(row, b))) {
          groups = [...groups.slice(0, index), { min: a.min, max: b.max }, ...groups.slice(index + 2)];
          merged = true;
          break;
        }
      }
    }
    // Title words name the nearest column; a word far from every column is a column the sample left empty.
    const columns: Array<{ x: number; min: number; max: number; words: string[] }> = groups.map((group) => ({ x: group.min, ...group, words: [] }));
    for (const piece of titlePieces) {
      const text = piece.text.trim();
      if (!text) continue;
      let nearest: (typeof columns)[number] | null = null;
      let distance = Infinity;
      for (const column of columns) {
        const gap = piece.x < column.min ? column.min - piece.x : piece.x > column.max ? piece.x - column.max : 0;
        if (gap < distance) { nearest = column; distance = gap; }
      }
      if (nearest && distance <= OWN_COLUMN) nearest.words.push(text);
      else columns.push({ x: piece.x, min: piece.x, max: piece.x, words: [text] });
    }
    columns.sort((a, b) => a.x - b.x);
    const used = new Set<string>();
    const named = columns.map((column, index) => {
      const base = column.words.join(" ").replace(/\s+/g, " ").trim() || `Column ${index + 1}`;
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
      used.add(name);
      return { name, x: Math.max(0, Math.floor(column.x) - 1), column };
    }).filter((column, index, all) => index === 0 || column.x > all[index - 1].x);

    // The row start: the leftmost column most rows fill; letters every value starts with stay literal.
    const starter = named.find(({ column }) => main.filter((row) => inGroup(row, column)).length >= Math.ceil(main.length * 0.6)) ?? named[0];
    const firsts = main.map((row) => row.pieces.find((piece) => piece.x >= starter.column.min && piece.x <= starter.column.max)?.text.trim() ?? "").filter(Boolean);
    const prefix = firsts.length ? firsts.reduce((common, text) => { let i = 0; while (i < common.length && i < text.length && common[i] === text[i] && /[A-Za-z]/.test(common[i])) i++; return common.slice(0, i); }) : "";
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Values with no digit in them (Corebridge's company code "AGL") are matched as they are.
    const pattern = firsts.length && firsts.every(hasDigits)
      ? `^(?=.*\\d)${escape(prefix)}[A-Za-z0-9][A-Za-z0-9/-]*$`
      : `^(${[...new Set(firsts)].map(escape).join("|") || "\\S+"})$`;
    // The table ends where the next table's titles are printed.
    const nextTitle = lines.slice(at + depth).find((line) => isTitleLine(line) && flat(line.text) !== flat(lines[at].text));
    const layout: PdfLayout = {
      columns: named.map(({ name, x }) => ({ name, x })),
      rowStart: { column: starter.name, pattern },
      // The whole title line, so only the table's own titles (on every page) start it.
      start: title,
      ...(nextTitle ? { stop: [nextTitle.pieces.map((piece) => piece.text.trim()).join(" ")] } : {}),
    };
    tables.push({ title, line: at, rows: Math.max(0, pdfGrid(lines, layout).length - 1), layout });
  }
  // A page's first line is its running head (the carrier's name, "SUMMARY STATEMENT"), not a table's titles.
  const pageTop = (table: PdfTableDraft) => (table.line === 0 || (lines[table.line].page !== undefined && lines[table.line].page !== lines[table.line - 1].page) ? 1 : 0);
  // Then the table that reads the most rows; then the one whose columns all have names.
  const titled = (table: PdfTableDraft) => table.layout.columns.filter((column) => !/^Column \d+$/.test(column.name)).length;
  return tables.filter((table) => table.rows > 0).sort((a, b) => pageTop(a) - pageTop(b) || b.rows - a.rows || titled(b) - titled(a) || a.line - b.line);
}
