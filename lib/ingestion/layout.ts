/**
 * LA-4.3 (Notion sprint) · reading raw rows into typed rows through a layout map.
 *
 * A layout map is data, not code: for each source column (its header, verbatim) the field it
 * becomes, that field's type, one named transform, whether it is required, and — for an enum —
 * the carrier's words for each value. This module turns a file's raw rows (LA-4.2) into typed rows
 * with it, and says what it noticed. It is deterministic and pure: no model, no network, no database
 * (an acceptance criterion, pinned by layout.test.mjs). Money is integer cents and rates integer
 * basis points; nothing here is ever a float.
 *
 *   · a required column missing          → the file fails; nothing goes further
 *   · stated totals that do not add up   → the file fails (the LA-4.4 balance rule, for spreadsheets)
 *   · a column the map does not know     → parsed anyway; a finding
 *   · a row-count swing past the map's threshold → parsed anyway; a finding
 *   · a value that cannot be read        → that row is held back; a finding
 *
 * Relative imports only.
 */
import { gridFromRaw, rawRowsFromGrid, type RawColumn, type RawRow } from "./grid.ts";

export const DATA_TYPES = ["text", "int_cents", "date", "basis_points", "enum", "integer"] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const TRANSFORMS = ["none", "strip_currency", "mmddyyyy", "yyyymmdd", "digits_only", "negate", "pct_to_bp"] as const;
export type Transform = (typeof TRANSFORMS)[number];

/** Which transforms make sense for which type. */
export const TRANSFORMS_FOR: Record<DataType, readonly Transform[]> = {
  text: ["none", "digits_only"],
  int_cents: ["none", "strip_currency", "negate"],
  date: ["none", "mmddyyyy", "yyyymmdd"],
  basis_points: ["none", "pct_to_bp", "negate"],
  enum: ["none"],
  integer: ["none", "negate"],
};

/**
 * `verbatim`: kept exactly as the cell has it — not even trimmed. The carrier's status word is
 * matched exactly by LA-4.5's status map, so "ACTIVE " must stay "ACTIVE ", not become "ACTIVE".
 */
export type TargetField = { key: string; label: string; dataType: DataType; enumValues?: readonly string[]; verbatim?: true };

const POLICY_FIELDS: TargetField[] = [
  { key: "policy_number", label: "Policy number", dataType: "text" },
  { key: "carrier_status_raw", label: "Status (the carrier's words)", dataType: "text", verbatim: true },
  { key: "paid_to_date", label: "Paid-to date", dataType: "date" },
  { key: "effective_date", label: "Effective date", dataType: "date" },
  { key: "issue_date", label: "Issue date", dataType: "date" },
  { key: "application_date", label: "Application date", dataType: "date" },
  { key: "termination_date", label: "Termination date", dataType: "date" },
  { key: "premium_cents", label: "Premium", dataType: "int_cents" },
  { key: "premium_mode", label: "Premium mode", dataType: "enum", enumValues: ["monthly", "quarterly", "semiannual", "annual"] },
  { key: "payment_method", label: "Payment method", dataType: "enum", enumValues: ["bank_draft", "direct_express", "card", "direct_bill"] },
  { key: "face_amount_cents", label: "Face amount", dataType: "int_cents" },
  { key: "product_code", label: "Product code", dataType: "text" },
  { key: "product_tier", label: "Product tier", dataType: "text" },
  { key: "agent_identifier", label: "Writing agent (as the carrier spells it)", dataType: "text" },
  { key: "insured_name", label: "Insured name", dataType: "text" },
  { key: "insured_first_name", label: "Insured first name", dataType: "text" },
  { key: "insured_last_name", label: "Insured last name", dataType: "text" },
  { key: "insured_dob", label: "Insured date of birth", dataType: "date" },
  { key: "insured_phone", label: "Insured phone", dataType: "text" },
  { key: "insured_address", label: "Insured address", dataType: "text" },
  { key: "insured_state", label: "Insured state", dataType: "text" },
  { key: "insured_zip", label: "Insured ZIP", dataType: "text" },
];

const COMMISSION_FIELDS: TargetField[] = [
  { key: "policy_number", label: "Policy number", dataType: "text" },
  { key: "entry_type", label: "Entry type", dataType: "enum", enumValues: ["advance", "earned", "chargeback", "reversal", "fee", "override", "advance_interest", "held"] },
  { key: "transaction_date", label: "Transaction date", dataType: "date" },
  { key: "amount_cents", label: "Amount", dataType: "int_cents" },
  { key: "rate_bp", label: "Rate", dataType: "basis_points" },
  { key: "commissionable_premium_cents", label: "Commissionable premium", dataType: "int_cents" },
  { key: "months_advanced", label: "Months advanced", dataType: "integer" },
  { key: "agent_identifier", label: "Writing agent (as the carrier spells it)", dataType: "text" },
  { key: "insured_name", label: "Insured name", dataType: "text" },
  { key: "statement_date", label: "Statement date", dataType: "date" },
];

export const TARGET_FIELDS: Record<"policies" | "commissions", TargetField[]> = { policies: POLICY_FIELDS, commissions: COMMISSION_FIELDS };

/** The fields a file of each type cannot be read without. */
export const REQUIRED_TARGETS: Record<"policies" | "commissions", string[]> = {
  policies: ["policy_number", "carrier_status_raw"],
  commissions: ["policy_number", "amount_cents"],
};

export type LayoutMap = {
  id: string;
  version: number;
  fileType: "policies" | "commissions";
  headerRowIndex: number | null;
  sheetName: string | null;
  rowCountSwingPct: number;
  totalRowColumn: string | null;
  totalRowValue: string | null;
};

export type LayoutEntry = {
  sourceColumn: string;
  targetField: string;
  dataType: DataType;
  transform: Transform;
  required: boolean;
  enumValues: Record<string, string> | null;
};

export type AssignmentRow = { tenantId: string | null; carrierId: string; fileType: "policies" | "commissions"; layoutKey: string };
export type PublishedMapRow = { id: string; tenantId: string | null; layoutKey: string; fileType: "policies" | "commissions"; status: string };

/**
 * Which map reads a carrier's file of one type for one agency — the resolution order the spec sets:
 * the agency's own assignment, else the platform's; then, for that layout, the agency's own published
 * version, else the platform's; else none. A new carrier with a known layout is one assignment row.
 */
export function chooseLayoutMap<M extends PublishedMapRow>(input: { tenantId: string; carrierId: string; fileType: "policies" | "commissions"; assignments: AssignmentRow[]; maps: M[] }): M | null {
  const forCarrier = input.assignments.filter((row) => row.carrierId === input.carrierId && row.fileType === input.fileType);
  const assignment = forCarrier.find((row) => row.tenantId === input.tenantId) ?? forCarrier.find((row) => row.tenantId === null);
  if (!assignment) return null;
  const live = input.maps.filter((map) => map.layoutKey === assignment.layoutKey && map.status === "published" && map.fileType === input.fileType);
  return live.find((map) => map.tenantId === input.tenantId) ?? live.find((map) => map.tenantId === null) ?? null;
}

/** What is wrong with a map before it may be published; empty when it is sound. */
export function mapProblems(map: Pick<LayoutMap, "fileType">, entries: LayoutEntry[]): string[] {
  const fields = new Map(TARGET_FIELDS[map.fileType].map((field) => [field.key, field]));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const field = fields.get(entry.targetField);
    if (!field) { problems.push(`"${entry.targetField}" is not a field of a ${map.fileType} file.`); continue; }
    if (seen.has(entry.targetField)) problems.push(`"${field.label}" is mapped twice.`);
    seen.add(entry.targetField);
    if (!entry.sourceColumn.length) problems.push(`"${field.label}" has no source column.`);
    if (entry.dataType !== field.dataType) problems.push(`"${field.label}" is read as ${field.dataType}, not ${entry.dataType}.`);
    if (!TRANSFORMS_FOR[entry.dataType].includes(entry.transform)) problems.push(`"${field.label}": the ${entry.transform} transform does not apply to ${entry.dataType}.`);
    if (entry.dataType === "enum") {
      const values = Object.values(entry.enumValues ?? {});
      if (!values.length) problems.push(`"${field.label}" needs the carrier's word for each value.`);
      for (const value of values) if (!field.enumValues?.includes(value)) problems.push(`"${field.label}": "${value}" is not one of ${field.enumValues?.join(", ")}.`);
    }
  }
  for (const key of REQUIRED_TARGETS[map.fileType]) if (!seen.has(key)) problems.push(`A ${map.fileType} map must read "${fields.get(key)?.label}".`);
  return problems;
}

export type CellValue = string | number | null;
type Converted = { ok: true; value: CellValue } | { ok: false; reason: string };

function realDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1900 || year > 2100) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "12.50" → 1250, "(1,204.00)" → -120400 with strip_currency. Never a float: the digits are split. */
function cents(text: string, strip: boolean): number | null {
  let value = text.trim();
  if (strip) value = value.replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1); }
  if (value.startsWith("-")) { negative = !negative; value = value.slice(1); }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole * 100 + fraction)) return null;
  const result = whole * 100 + fraction;
  return negative ? -result : result;
}

/** "110%" or "110.5" → basis points (11000, 11050) with pct_to_bp; else a whole number of bp. */
function basisPoints(text: string, fromPercent: boolean): number | null {
  const value = text.trim().replace(/%$/, "").trim();
  if (!fromPercent) return /^-?\d+$/.test(value) ? Number(value) : null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const bp = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -bp : bp;
}

/** One cell through one map entry. An empty (or all-space) cell is null, and an error only if required. */
export function convertCell(raw: string, entry: Pick<LayoutEntry, "dataType" | "transform" | "enumValues" | "required">, options: { verbatim?: boolean } = {}): Converted {
  if (raw.trim() === "") return entry.required ? { ok: false, reason: "is empty" } : { ok: true, value: null };
  const negate = entry.transform === "negate";
  switch (entry.dataType) {
    case "text": {
      if (options.verbatim && entry.transform === "none") return { ok: true, value: raw };
      const value = entry.transform === "digits_only" ? raw.replace(/\D/g, "") : raw.trim();
      return value === "" && entry.required ? { ok: false, reason: "has no digits" } : { ok: true, value: value || null };
    }
    case "int_cents": {
      const value = cents(raw, entry.transform === "strip_currency");
      if (value === null) return { ok: false, reason: `"${raw}" is not an amount` };
      return { ok: true, value: negate ? -value : value };
    }
    case "basis_points": {
      const value = basisPoints(raw, entry.transform === "pct_to_bp");
      if (value === null) return { ok: false, reason: `"${raw}" is not a rate` };
      return { ok: true, value: negate ? -value : value };
    }
    case "integer": {
      const value = raw.trim();
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return { ok: false, reason: `"${raw}" is not a whole number` };
      return { ok: true, value: negate ? -Number(value) : Number(value) };
    }
    case "date": {
      const value = raw.trim();
      let parsed: string | null = null;
      if (entry.transform === "mmddyyyy") {
        const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(value);
        if (match) parsed = realDate(Number(match[3]), Number(match[1]), Number(match[2]));
      } else if (entry.transform === "yyyymmdd") {
        const match = /^(\d{4})[/-]?(\d{2})[/-]?(\d{2})$/.exec(value);
        if (match) parsed = realDate(Number(match[1]), Number(match[2]), Number(match[3]));
      } else {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (match) parsed = realDate(Number(match[1]), Number(match[2]), Number(match[3]));
      }
      return parsed ? { ok: true, value: parsed } : { ok: false, reason: `"${raw}" is not a date this map reads` };
    }
    case "enum": {
      const value = entry.enumValues?.[raw.trim()];
      return value ? { ok: true, value } : { ok: false, reason: `"${raw}" is not a value this map knows` };
    }
  }
}

export type TypedRow = { rowNumber: number; values: Record<string, CellValue> };
export type RowProblem = { rowNumber: number; field: string; reason: string };

export type Finding = {
  findingType: "unknown_column" | "row_count_swing" | "unreadable_values" | "required_column_missing" | "totals_mismatch" | "header_row_moved" | "total_row_not_found" | "unmapped_status";
  severity: "info" | "warning" | "blocking";
  reasoning: string;
  payload: Record<string, unknown>;
};

export type ParseInput = {
  map: LayoutMap;
  entries: LayoutEntry[];
  /** The file's raw layer: what LA-4.2 kept. */
  raw: { headerRow: number; columns: RawColumn[]; preamble: string[][]; rows: RawRow[]; sheetName: string | null };
  /** Rows in the previous file of this carrier and type, for the swing check; null when none. */
  previousRowCount: number | null;
};

export type ParseResult = {
  /** Why the file cannot be read with this map; null when it parsed. */
  fatal: string | null;
  rows: TypedRow[];
  heldBack: RowProblem[];
  findings: Finding[];
  statedTotalCents: number | null;
  linesTotalCents: number | null;
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Reads one file's raw rows with one map. Pure; the same input always gives the same output. */
export function parseWithMap(input: ParseInput): ParseResult {
  const { map, entries } = input;
  const verbatimFields = new Set(TARGET_FIELDS[map.fileType].filter((field) => field.verbatim).map((field) => field.key));
  const findings: Finding[] = [];
  const result = (fatal: string | null, rows: TypedRow[] = [], heldBack: RowProblem[] = [], stated: number | null = null, lines: number | null = null): ParseResult =>
    ({ fatal, rows, heldBack, findings, statedTotalCents: stated, linesTotalCents: lines });

  if (map.sheetName && input.raw.sheetName && map.sheetName !== input.raw.sheetName) {
    return result(`This map reads the sheet "${map.sheetName}", but this file's rows came from "${input.raw.sheetName}".`);
  }

  // The map knows where the header is; the raw layer only guessed. The whole grid is kept, so it can be re-read.
  let raw = input.raw;
  if (map.headerRowIndex && map.headerRowIndex !== raw.headerRow) {
    const grid = gridFromRaw(raw);
    if (map.headerRowIndex > grid.length) return result(`This map's header is on line ${map.headerRowIndex}, but the file has ${grid.length} lines.`);
    const reread = rawRowsFromGrid(grid, map.headerRowIndex);
    findings.push({ findingType: "header_row_moved", severity: "info", reasoning: `The map reads the header from line ${map.headerRowIndex}; the file was first read with line ${raw.headerRow}.`, payload: { detected: raw.headerRow, map: map.headerRowIndex } });
    raw = { ...raw, ...reread };
  }

  const keyFor = new Map<string, string>();
  for (const column of raw.columns) if (!keyFor.has(column.header)) keyFor.set(column.header, column.key);
  const missingRequired = entries.filter((entry) => entry.required && !keyFor.has(entry.sourceColumn));
  if (missingRequired.length) {
    const names = missingRequired.map((entry) => `"${entry.sourceColumn}"`).join(", ");
    findings.push({ findingType: "required_column_missing", severity: "blocking", reasoning: `The file has no ${names} column, which this map requires.`, payload: { columns: missingRequired.map((entry) => entry.sourceColumn) } });
    return result(`Required column ${names} is missing, so nothing was read from this file.`);
  }
  const mapped = new Set(entries.map((entry) => entry.sourceColumn));
  const unknown = raw.columns.filter((column) => column.header.trim() !== "" && !mapped.has(column.header)).map((column) => column.header);
  if (unknown.length) findings.push({ findingType: "unknown_column", severity: "warning", reasoning: `${unknown.length === 1 ? "A column" : `${unknown.length} columns`} this map does not read: ${unknown.map((name) => `"${name}"`).join(", ")}. Every value is kept in the raw rows.`, payload: { columns: unknown } });

  const isTotalRow = (row: RawRow) => Boolean(map.totalRowColumn && keyFor.has(map.totalRowColumn) && (row.payload[keyFor.get(map.totalRowColumn)!] ?? "").trim() === map.totalRowValue);
  const amountEntry = entries.find((entry) => entry.targetField === "amount_cents");

  const rows: TypedRow[] = [];
  const heldBack: RowProblem[] = [];
  let statedTotal: number | null = null;
  for (const row of raw.rows) {
    if (Object.values(row.payload).every((value) => value.trim() === "")) continue;
    if (isTotalRow(row)) {
      if (amountEntry && keyFor.has(amountEntry.sourceColumn)) {
        const converted = convertCell(row.payload[keyFor.get(amountEntry.sourceColumn)!] ?? "", { ...amountEntry, required: true });
        if (converted.ok) statedTotal = converted.value as number;
        else return result(`The stated total on line ${row.rowNumber} cannot be read: it ${converted.reason}.`);
      }
      continue;
    }
    const values: Record<string, CellValue> = {};
    let rowOk = true;
    for (const entry of entries) {
      const key = keyFor.get(entry.sourceColumn);
      if (!key) { values[entry.targetField] = null; continue; }
      const converted = convertCell(row.payload[key] ?? "", entry, { verbatim: verbatimFields.has(entry.targetField) });
      if (converted.ok) values[entry.targetField] = converted.value;
      else { rowOk = false; heldBack.push({ rowNumber: row.rowNumber, field: entry.targetField, reason: converted.reason }); }
    }
    if (rowOk) rows.push({ rowNumber: row.rowNumber, values });
  }

  if (heldBack.length) {
    const lines = [...new Set(heldBack.map((problem) => problem.rowNumber))];
    findings.push({ findingType: "unreadable_values", severity: "warning", reasoning: `${lines.length} ${lines.length === 1 ? "row was" : "rows were"} held back: a value could not be read (first on line ${heldBack[0].rowNumber}: ${heldBack[0].field} ${heldBack[0].reason}).`, payload: { rows: lines.length, sample: heldBack.slice(0, 20) } });
  }

  let linesTotal: number | null = null;
  if (map.totalRowColumn) {
    if (statedTotal === null) {
      findings.push({ findingType: "total_row_not_found", severity: "warning", reasoning: `No row has "${map.totalRowValue}" in "${map.totalRowColumn}", so the file's stated total could not be checked.`, payload: {} });
    } else {
      if (heldBack.length) return result(`The stated total cannot be checked while ${new Set(heldBack.map((p) => p.rowNumber)).size} rows cannot be read, so nothing was read from this file.`, [], heldBack, statedTotal);
      linesTotal = rows.reduce((sum, row) => sum + ((row.values.amount_cents as number | null) ?? 0), 0);
      if (linesTotal !== statedTotal) {
        findings.push({ findingType: "totals_mismatch", severity: "blocking", reasoning: `The lines add up to ${money(linesTotal)}, the file states ${money(statedTotal)}: a difference of ${money(linesTotal - statedTotal)}.`, payload: { linesTotalCents: linesTotal, statedTotalCents: statedTotal, differenceCents: linesTotal - statedTotal } });
        return result(`Totals don't add up: the lines sum to ${money(linesTotal)}, the file states ${money(statedTotal)}, a difference of ${money(linesTotal - statedTotal)}. Nothing was read from this file.`, [], heldBack, statedTotal, linesTotal);
      }
    }
  }

  if (input.previousRowCount !== null && input.previousRowCount > 0) {
    const swing = Math.round((Math.abs(rows.length - input.previousRowCount) / input.previousRowCount) * 100);
    if (swing > map.rowCountSwingPct) {
      findings.push({ findingType: "row_count_swing", severity: "warning", reasoning: `${rows.length} rows, against ${input.previousRowCount} in the previous file — a ${swing}% change, past this map's ${map.rowCountSwingPct}%.`, payload: { rows: rows.length, previous: input.previousRowCount, swingPct: swing } });
    }
  }
  return result(null, rows, heldBack, statedTotal, linesTotal);
}
