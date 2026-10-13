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
import type { CarrierFileType } from "./constants.ts";
import { gridFromRaw, rawRowsFromGrid, type RawColumn, type RawRow } from "./grid.ts";
import { PDF_TOTAL_MARKER } from "./pdfLayout.ts";

export const DATA_TYPES = ["text", "int_cents", "date", "basis_points", "enum", "integer"] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const TRANSFORMS = ["none", "strip_currency", "mmddyyyy", "mmddyy", "yyyymmdd", "digits_only", "negate", "pct_to_bp", "fraction_to_bp"] as const;
export type Transform = (typeof TRANSFORMS)[number];

/** Which transforms make sense for which type. */
export const TRANSFORMS_FOR: Record<DataType, readonly Transform[]> = {
  text: ["none", "digits_only"],
  int_cents: ["none", "strip_currency", "negate"],
  date: ["none", "mmddyyyy", "mmddyy", "yyyymmdd"],
  basis_points: ["none", "pct_to_bp", "fraction_to_bp", "negate"],
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
  // What the carrier says the line is, kept for a line that names no policy (account-level, 2026-10-09).
  { key: "description", label: "Line description", dataType: "text" },
  // Whose commission the line is: the writing agent's, or an upline's override (LA-4.12).
  { key: "payee_level", label: "Paid to (writing agent or upline)", dataType: "enum", enumValues: ["writing_agent", "upline"] },
];

// A new-business file (applications not issued yet) is read with the policy fields.
export const TARGET_FIELDS: Record<CarrierFileType, TargetField[]> = { policies: POLICY_FIELDS, commissions: COMMISSION_FIELDS, new_business: POLICY_FIELDS };

/** Header words → field, compared with case, spaces and punctuation removed. A suggestion staff confirm, never a mapping on its own. */
const HEADER_HINTS: Record<"policies" | "commissions", Record<string, string[]>> = {
  policies: {
    policy_number: ["policy", "policynumber", "policyno", "policynum", "policyid", "contract", "contractnumber", "certificate"],
    carrier_status_raw: ["status", "policystatus", "contractstatus"],
    paid_to_date: ["paidto", "paidtodate", "paidthrough", "paidthru", "ptd"],
    effective_date: ["effective", "effectivedate", "effdate", "policydate", "origeffdate"],
    issue_date: ["issue", "issuedate", "issued"],
    application_date: ["appdate", "applicationdate", "appreceived", "receiveddate", "apprecddate", "signeddate"],
    termination_date: ["termdate", "terminationdate", "terminateddate", "lapsedate"],
    premium_cents: ["premium", "modalpremium", "modeprem", "currentmodalpremium", "premiumamount"],
    premium_mode: ["mode", "premiummode", "billingmode", "frequency", "freq"],
    payment_method: ["paymentmethod", "billingmethod", "billmethod", "billtype"],
    face_amount_cents: ["face", "faceamount", "coverage", "deathbenefit", "benefitamount"],
    product_code: ["product", "productcode", "plan", "plancode"],
    product_tier: ["tier", "producttier", "rateclass", "underwritingclass"],
    agent_identifier: ["agent", "writingagent", "agentname", "agentnumber", "writingagentnumber", "producer"],
    insured_name: ["insured", "insuredname", "name", "clientname", "ownername"],
    insured_first_name: ["firstname", "first", "insuredfirstname", "fname"],
    insured_last_name: ["lastname", "last", "insuredlastname", "lname", "surname"],
    insured_dob: ["dob", "dateofbirth", "birthdate", "insureddob"],
    insured_phone: ["phone", "phonenumber", "insuredphone", "homephone", "cellphone"],
    insured_address: ["address", "address1", "street", "insuredaddress"],
    insured_state: ["state", "st", "insuredstate"],
    insured_zip: ["zip", "zipcode", "postalcode", "insuredzip"],
  },
  commissions: {
    policy_number: ["policy", "policynumber", "policyno", "contract"],
    entry_type: ["type", "commissiontype", "action", "activitytype", "commtype", "transactiontype"],
    transaction_date: ["date", "transactiondate", "processdate", "paiddate"],
    amount_cents: ["amount", "commission", "commissionamount", "paid", "netamount"],
    rate_bp: ["rate", "commissionrate", "pct", "percent"],
    commissionable_premium_cents: ["commissionablepremium", "targetpremium", "basepremium", "premium"],
    months_advanced: ["months", "monthsadvanced", "advancemonths"],
    agent_identifier: ["agent", "writingagent", "agentname", "agentnumber"],
    insured_name: ["insured", "insuredname", "name", "clientname"],
    statement_date: ["statementdate", "statement", "payperiod", "period"],
    payee_level: ["payee", "level", "uplineorwriting", "paidto", "writingorupline"],
  },
};

const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The field a file's column header most likely is, or null. Only exact (normalised) words count. */
export function guessTargetField(fileType: CarrierFileType, header: string): string | null {
  const key = headerKey(header);
  if (!key) return null;
  for (const [field, words] of Object.entries(HEADER_HINTS[fileType === "commissions" ? "commissions" : "policies"])) if (words.includes(key)) return field;
  return null;
}

/** The fields a file of each type cannot be read without. */
export const REQUIRED_TARGETS: Record<CarrierFileType, string[]> = {
  policies: ["policy_number", "carrier_status_raw"],
  new_business: ["policy_number", "carrier_status_raw"],
  // LA-4.12: a line the ledger cannot classify is not a ledger line.
  commissions: ["policy_number", "amount_cents", "entry_type"],
};

export type LayoutMap = {
  id: string;
  version: number;
  fileType: CarrierFileType;
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

export type AssignmentRow = { tenantId: string | null; carrierId: string; fileType: CarrierFileType; layoutKey: string };
export type PublishedMapRow = { id: string; tenantId: string | null; layoutKey: string; fileType: CarrierFileType; status: string };

/**
 * Which map reads a carrier's file of one type for one agency — the resolution order the spec sets:
 * the agency's own assignment, else the platform's; then, for that layout, the agency's own published
 * version, else the platform's; else none. A new carrier with a known layout is one assignment row.
 */
export function chooseLayoutMap<M extends PublishedMapRow>(input: { tenantId: string; carrierId: string; fileType: CarrierFileType; assignments: AssignmentRow[]; maps: M[] }): M | null {
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
  // "13,235.56-": some statements put the minus after the amount.
  if (value.endsWith("-") && value.length > 1) { negative = !negative; value = value.slice(0, -1); }
  if (value.startsWith("-")) { negative = !negative; value = value.slice(1); }
  // Binary noise from a spreadsheet save: Excel writes 276.72 as 276.72000000000003 and 1083.60 as
  // 1083.5999999999999. Ten or more decimals within a millionth of a cent are that cent; a real
  // third decimal (12.345) is still not an amount.
  if (/^\d+\.\d{10,}$/.test(value)) {
    const hundredths = Number(value) * 100;
    if (Math.abs(hundredths - Math.round(hundredths)) < 1e-6) value = (Math.round(hundredths) / 100).toFixed(2);
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(whole * 100 + fraction)) return null;
  const result = whole * 100 + fraction;
  return negative ? -result : result;
}

/**
 * "110%" or "110.5" → basis points (11000, 11050) with pct_to_bp; "0.825" or ".75000" → 8250, 7500
 * with fraction_to_bp (a rate written as a fraction of one); else a whole number of bp.
 */
function basisPoints(text: string, fromPercent: boolean, fromFraction = false): number | null {
  const value = text.trim().replace(/%$/, "").trim();
  if (fromFraction) {
    const match = /^(-?)(\d*)(?:\.(\d{1,8}))?$/.exec(value);
    if (!match || (!match[2] && !match[3])) return null;
    const digits = (match[3] ?? "").padEnd(8, "0");
    // Whole bp only: 0.825 is 8250 bp exactly; a fraction finer than a basis point is not a rate this reads.
    if (Number(digits.slice(4)) !== 0) return null;
    const bp = Number(match[2] || "0") * 10000 + Number(digits.slice(0, 4));
    return match[1] ? -bp : bp;
  }
  if (!fromPercent) return /^-?\d+$/.test(value) ? Number(value) : null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const bp = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -bp : bp;
}

/**
 * A spreadsheet "text" cell written as a formula so leading zeros survive: ="0119859720" or
 * =("0119859720"), which a CSV keeps as =0119859720 or =(0119859720). The value inside, else the cell.
 */
export function unwrapExcelText(raw: string): string {
  const match = /^=\(?"?([^"()=]*)"?\)?$/.exec(raw.trim());
  return match ? match[1] : raw;
}

/**
 * A carrier date after someone opened the file in Excel and saved it (owner request 2026-10-13:
 * a file we edit ourselves must still read). Tried only when the map's own format did not match:
 *   - ISO 2026-07-08, kept by some saves whatever the column's format;
 *   - US 7/8/2026 (four-digit year), what Excel writes into a CSV for any date it recognised;
 *   - an Excel date serial, 46202 = 2026-06-29, what Excel 2003 XML (.xls) and some CSV saves hold
 *     once a date cell has lost its format. Five digits, 1950–2100 only: a six- or eight-digit date
 *     (mmddyy, yyyymmdd) can never be read as one.
 */
export function excelSavedDate(value: string): string | null {
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (match) return realDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (match) return realDate(Number(match[3]), Number(match[1]), Number(match[2]));
  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    // 18264 = 1950-01-01, 73415 = 2100-12-31. Day 0 is 1899-12-30 (Excel's 1900 leap-year quirk folded in).
    if (serial < 18264 || serial > 73415) return null;
    const day = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return realDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
  }
  return null;
}

/**
 * A US ZIP that a spreadsheet stored as a number lost its leading zero: Excel saves 08270 as 8270
 * (and 08270-1234 as 8270-1234). Three or four digits are put back to five; anything else is left.
 */
export function restoreZip(value: CellValue): CellValue {
  if (typeof value !== "string") return value;
  const match = /^(\d{3,4})(-\d{4})?$/.exec(value);
  return match ? match[1].padStart(5, "0") + (match[2] ?? "") : value;
}

/**
 * A policy's premium or face amount written past the cent ("41.92302": Corebridge's in-force report,
 * 2026-10-13) is that amount to the nearest cent. Only these two policy fields: a commission line's
 * money must be exact, and still refuses a third decimal.
 */
export const ROUNDED_TO_CENT = new Set(["premium_cents", "face_amount_cents"]);
export function roundToCent(raw: string): string {
  const match = /^(\s*\(?)(-?)(\$?)([\d,]*)\.(\d{3,})(\)?-?\s*)$/.exec(raw);
  if (!match) return raw;
  const value = Number(`${match[4].replaceAll(",", "") || "0"}.${match[5]}`);
  if (!Number.isFinite(value)) return raw;
  return `${match[1]}${match[2]}${match[3]}${(Math.round(value * 100) / 100).toFixed(2)}${match[6]}`;
}

/** One cell through one map entry. An empty (or all-space) cell is null, and an error only if required. */
export function convertCell(input: string, entry: Pick<LayoutEntry, "dataType" | "transform" | "enumValues" | "required">, options: { verbatim?: boolean } = {}): Converted {
  const raw = unwrapExcelText(input);
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
      const value = basisPoints(raw, entry.transform === "pct_to_bp", entry.transform === "fraction_to_bp");
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
      } else if (entry.transform === "mmddyy") {
        // 8/6/26, 07/08/26, 061426 or 08/06/2026: a two-digit year is 20YY.
        const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(value) ?? /^(\d{2})(\d{2})(\d{2})$/.exec(value);
        if (match) parsed = realDate(match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]), Number(match[1]), Number(match[2]));
      } else if (entry.transform === "yyyymmdd") {
        const match = /^(\d{4})[/-]?(\d{2})[/-]?(\d{2})$/.exec(value);
        if (match) parsed = realDate(Number(match[1]), Number(match[2]), Number(match[3]));
      } else {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (match) parsed = realDate(Number(match[1]), Number(match[2]), Number(match[3]));
      }
      parsed ??= excelSavedDate(value);
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

  // A header is found by its exact text first, then with the spaces around it ignored on both sides:
  // the same carrier's report can say "Date of Issue " one month and "Date of Issue  " the next
  // (Corebridge, 2026-10-13), and the spaces are invisible to whoever builds the map.
  const byHeader = new Map<string, string>();
  for (const column of raw.columns) if (!byHeader.has(column.header)) byHeader.set(column.header, column.key);
  for (const column of raw.columns) if (column.header.trim() && !byHeader.has(column.header.trim())) byHeader.set(column.header.trim(), column.key);
  const keyFor = {
    has: (name: string) => byHeader.has(name) || byHeader.has(name.trim()),
    get: (name: string) => byHeader.get(name) ?? byHeader.get(name.trim()),
  };
  // A source column written "=annual" is a fixed value for every row: what the carrier's file never
  // says because it is always the same (Americo's premium is always annual).
  const isConstant = (entry: LayoutEntry) => entry.sourceColumn.startsWith("=") && entry.sourceColumn.length > 1;
  // "Status + Reason": two columns read as one, their non-empty values joined by a space (SSL says
  // what a cancellation was in a second column: "Cancelled" + "[NP] Non Payment of Premium").
  const parts = (entry: LayoutEntry) => (entry.sourceColumn.includes(" + ") ? entry.sourceColumn.split(" + ") : null);
  const present = (entry: LayoutEntry) => isConstant(entry) || (parts(entry) ? parts(entry)!.every((part) => keyFor.has(part)) : keyFor.has(entry.sourceColumn));
  const missingRequired = entries.filter((entry) => entry.required && !present(entry));
  if (missingRequired.length) {
    const names = missingRequired.map((entry) => `"${entry.sourceColumn}"`).join(", ");
    findings.push({ findingType: "required_column_missing", severity: "blocking", reasoning: `The file has no ${names} column, which this map requires.`, payload: { columns: missingRequired.map((entry) => entry.sourceColumn) } });
    return result(`Required column ${names} is missing, so nothing was read from this file.`);
  }
  const mapped = new Set(entries.flatMap((entry) => parts(entry) ?? [entry.sourceColumn]).map((name) => name.trim()));
  const unknown = raw.columns.filter((column) => column.header.trim() !== "" && !mapped.has(column.header.trim())).map((column) => column.header);
  if (unknown.length) findings.push({ findingType: "unknown_column", severity: "warning", reasoning: `${unknown.length === 1 ? "A column" : `${unknown.length} columns`} this map does not read: ${unknown.map((name) => `"${name}"`).join(", ")}. Every value is kept in the raw rows.`, payload: { columns: unknown } });

  // A PDF statement's own total arrives as a marked row (LA-4.4, pdfLayout.ts); a spreadsheet's is named by the map.
  const isPdfTotal = (row: RawRow) => Object.values(row.payload).some((value) => value === PDF_TOTAL_MARKER);
  const isTotalRow = (row: RawRow) => isPdfTotal(row) || Boolean(map.totalRowColumn && keyFor.has(map.totalRowColumn) && (row.payload[keyFor.get(map.totalRowColumn)!] ?? "").trim() === map.totalRowValue);
  const statedByPdf = raw.rows.some(isPdfTotal);
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
      if (!present(entry)) { values[entry.targetField] = null; continue; }
      const joined = parts(entry);
      const key = keyFor.get(entry.sourceColumn);
      const cell = joined ? joined.map((part) => (row.payload[keyFor.get(part)!] ?? "").trim()).filter(Boolean).join(" ") : key ? row.payload[key] ?? "" : entry.sourceColumn.slice(1);
      const converted = convertCell(ROUNDED_TO_CENT.has(entry.targetField) ? roundToCent(cell) : cell, entry, { verbatim: verbatimFields.has(entry.targetField) });
      if (converted.ok) values[entry.targetField] = entry.targetField === "insured_zip" ? restoreZip(converted.value) : converted.value;
      else { rowOk = false; heldBack.push({ rowNumber: row.rowNumber, field: entry.targetField, reason: converted.reason }); }
    }
    if (rowOk) rows.push({ rowNumber: row.rowNumber, values });
  }

  if (heldBack.length) {
    const lines = [...new Set(heldBack.map((problem) => problem.rowNumber))];
    findings.push({ findingType: "unreadable_values", severity: "warning", reasoning: `${lines.length} ${lines.length === 1 ? "row was" : "rows were"} held back: a value could not be read (first on line ${heldBack[0].rowNumber}: ${heldBack[0].field} ${heldBack[0].reason}).`, payload: { rows: lines.length, sample: heldBack.slice(0, 20) } });
  }

  let linesTotal: number | null = null;
  if (map.totalRowColumn || statedByPdf) {
    if (statedTotal === null) {
      if (statedByPdf) return result("The statement's total is not in the column this map reads the amount from, so its lines cannot be checked. Nothing was read from this file.");
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
