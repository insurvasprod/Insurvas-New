import { parseCsv } from "../contacts/csv.ts";
import { isPhoneTemplateField, type TemplateField } from "../templates/constants.ts";

export { parseCsv };

/**
 * LA-2.2 criterion 6: "A 20,000-row file imports without the browser running out of memory."
 *
 * Raised from 2,000, which refused the criterion outright — a 20,000-row vendor file was answered
 * with "CSV cannot contain more than 2,000 leads", and the only way through was to split the file
 * by hand. That is the same class of manual pre-editing this task exists to remove.
 *
 * The cap is a real limit, not a formality: it bounds one transaction, and the whole batch either
 * commits or does not (criterion 3). The commit function's own guard must match this number, or
 * the server accepts a file the database will refuse.
 */
export const MAX_LEAD_IMPORT_ROWS = 20_000;

/**
 * How many rows a preview may parse into objects.
 *
 * Validation needs to know the whole file is sound, but the SCREEN only ever shows a handful of
 * lines and a count. Parsing 20,000 rows into typed objects to render three of them is where the
 * browser actually runs out of memory — so the preview parses a bounded head of the file and
 * reports the total separately. The full file is still validated once, on submit, on the server.
 */
export const MAX_PREVIEW_PARSE_ROWS = 2_000;

type ImportStage = { id: string; name: string; is_archived?: boolean };

const TIMEZONE_LABELS: Record<string, string> = {
  eastern: "America/New_York",
  central: "America/Chicago",
  mountain: "America/Denver",
  "mountain (no dst)": "America/Phoenix",
  pacific: "America/Los_Angeles",
};

const SPLIT_ZONE_ZIP3 = [
  [320, 323, "America/New_York"], [324, 325, "America/Chicago"], [326, 349, "America/New_York"],
  [370, 372, "America/Chicago"], [373, 379, "America/New_York"], [380, 385, "America/Chicago"],
] as const;

const STATE_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AR: "America/Chicago", AZ: "America/Phoenix", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu", IA: "America/Chicago",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", KS: "America/Chicago", KY: "America/Kentucky/Louisville", LA: "America/Chicago", MA: "America/New_York",
  MD: "America/New_York", ME: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MO: "America/Chicago", MS: "America/Chicago",
  MT: "America/Denver", NC: "America/New_York", ND: "America/Chicago", NE: "America/Chicago", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NV: "America/Los_Angeles", NY: "America/New_York", OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  UT: "America/Denver", VA: "America/New_York", VT: "America/New_York", WA: "America/Los_Angeles", WI: "America/Chicago", WV: "America/New_York", WY: "America/Denver",
};

export function normalizeImportPhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(normalized) ? normalized : null;
}

/**
 * How a slash date is read: `mdy` is 05/06/1961 = 6 May 1961 (US), `dmy` is 5 June 1961.
 *
 * Chosen once per file on the mapping dialog, because a file where both readings are valid for
 * hundreds of rows cannot be read correctly by guessing. With no order, slash dates are refused as
 * before — the direct import keeps that behaviour unless a caller passes one.
 */
export type ImportDateOrder = "mdy" | "dmy";
export const IMPORT_DATE_ORDERS = ["mdy", "dmy"] as const;
export function isImportDateOrder(value: unknown): value is ImportDateOrder {
  return value === "mdy" || value === "dmy";
}

/** The same century rule as the d-mmm-yy reading: a two-digit year after this year's is last century. */
function fullYear(year: number) {
  return year < 100 ? year + (year > new Date().getFullYear() % 100 ? 1900 : 2000) : year;
}

function isoDate(year: number, monthIndex: number, day: number) {
  if (monthIndex < 0 || monthIndex > 11 || day < 1) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.getUTCMonth() === monthIndex && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/** Both readings of a slash date, or null when the value is not one. */
export function slashDateReadings(raw: unknown): { mdy: string | null; dmy: string | null } | null {
  const match = SLASH_DATE.exec(String(raw ?? "").trim());
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = fullYear(Number(match[3]));
  return { mdy: isoDate(year, first - 1, second), dmy: isoDate(year, second - 1, first) };
}

export function normalizeImportDate(raw: unknown, dateOrder?: ImportDateOrder | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (/^\d{1,6}$/.test(value)) {
    const serial = Number(value);
    if (serial < 1 || serial > 60000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  if (dateOrder) {
    const readings = slashDateReadings(value);
    if (readings) return readings[dateOrder];
  }
  const match = /^(\d{1,2})-([a-z]{3})-(\d{2,4})$/i.exec(value);
  if (!match) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  return isoDate(fullYear(Number(match[3])), month, Number(match[1]));
}

/** What the mapping dialog needs to know about the slash dates in a file's date columns. */
export type ImportDateScan = {
  /** Slash dates seen in mapped date columns. */
  slashDates: number;
  /** Values where both readings are valid and differ, e.g. 05/06/1961. */
  ambiguous: number;
  /** Slash dates that are not a date when read month-first, and day-first. */
  invalidMdy: number;
  invalidDmy: number;
  firstAmbiguous: string | null;
  /** A slash date only one reading accepts, e.g. 03/14/1958. */
  firstUnambiguous: string | null;
  /** Ambiguous values per normalised header, so the dialog can flag the column. */
  ambiguousByHeader: Record<string, number>;
};

export const EMPTY_DATE_SCAN: ImportDateScan = { slashDates: 0, ambiguous: 0, invalidMdy: 0, invalidDmy: 0, firstAmbiguous: null, firstUnambiguous: null, ambiguousByHeader: {} };

function scanDateValue(scan: ImportDateScan, header: string, raw: string) {
  const value = raw.trim();
  const readings = slashDateReadings(value);
  if (!readings) return;
  scan.slashDates++;
  if (!readings.mdy) scan.invalidMdy++;
  if (!readings.dmy) scan.invalidDmy++;
  if (readings.mdy && readings.dmy && readings.mdy !== readings.dmy) {
    scan.ambiguous++;
    scan.ambiguousByHeader[header] = (scan.ambiguousByHeader[header] ?? 0) + 1;
    scan.firstAmbiguous ??= value;
  } else if (Boolean(readings.mdy) !== Boolean(readings.dmy)) {
    scan.firstUnambiguous ??= value;
  }
}

/**
 * The order to use when the person has not had to choose one: none when the file has no slash
 * dates (so nothing about the import changes), otherwise the reading that rejects fewer values,
 * month-first on a tie. Only meaningful when `ambiguous` is 0 — an ambiguous file needs a person.
 */
export function inferredImportDateOrder(scan: ImportDateScan): ImportDateOrder | null {
  if (scan.slashDates === 0) return null;
  return scan.invalidDmy < scan.invalidMdy ? "dmy" : "mdy";
}

export function resolveImportTimezone(label: unknown, zip: unknown, state?: unknown): string | null {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (digits.length >= 3) {
    const zip3 = Number(digits.slice(0, 3));
    for (const [from, to, zone] of SPLIT_ZONE_ZIP3) if (zip3 >= from && zip3 <= to) return zone;
  }
  const labelKey = String(label ?? "").trim().toLocaleLowerCase();
  if (TIMEZONE_LABELS[labelKey]) return TIMEZONE_LABELS[labelKey];
  const stateKey = String(state ?? "").trim().toUpperCase();
  if (stateKey === "FL" || stateKey === "TN") return null;
  return STATE_TIMEZONE[stateKey] ?? null;
}

/**
 * A row whose phone is present but is not a US number.
 *
 * Its own class so the preflight can file the row under "Phone failed validation" rather than
 * under "Unreadable": the row was read perfectly well, it just has nothing to dial.
 */
export class LeadImportPhoneError extends Error {}

export function normalizeImportValues(values: Record<string, unknown>, rowNumber: number, dateOrder?: ImportDateOrder | null): Record<string, unknown> {
  const normalized = { ...values };
  const phoneKey = ["phone", "phone_number", "primary_phone"].find((key) => key in normalized);
  if (phoneKey && normalized[phoneKey] !== undefined && normalized[phoneKey] !== "") {
    const phone = normalizeImportPhone(normalized[phoneKey]);
    if (!phone) throw new LeadImportPhoneError(`Row ${rowNumber}: phone must be a valid US phone number`);
    normalized[phoneKey] = phone;
  }
  const dobKey = ["date_of_birth", "dob"].find((key) => key in normalized);
  if (dobKey && normalized[dobKey] !== undefined && normalized[dobKey] !== "") {
    const date = normalizeImportDate(normalized[dobKey], dateOrder);
    if (!date) throw new Error(`Row ${rowNumber}: date of birth must be a valid date`);
    normalized[dobKey] = date;
  }
  const state = typeof normalized.state === "string" ? normalized.state.trim().toUpperCase() : normalized.state;
  if (state) normalized.state = state;
  if ("timezone" in normalized) {
    const timezone = resolveImportTimezone(normalized.timezone, normalized.zip ?? normalized.postal_code, state);
    if (!timezone) throw new Error(`Row ${rowNumber}: timezone cannot be resolved from the supplied state and ZIP`);
    normalized.timezone = timezone;
  }
  return normalized;
}

export type LeadImportRow = {
  rowNumber: number;
  stageId: string;
  values: Record<string, unknown>;
};

export type LeadImportPreview = {
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  /**
   * Per-row problems, capped for display. Previously a single bad cell anywhere in the file
   * produced `validRows: 0` and one message, so Ray fixed one row, re-uploaded, and found the
   * next one — twelve times for twelve bad rows. Criterion 4 asks the preview to show what will be
   * imported and what will be rejected; that needs a list, not the first exception.
   */
  rowErrors: Array<{ rowNumber: number; message: string }>;
  /** True when `rowErrors` was truncated, so the screen can say "and N more". */
  moreRowErrors: number;
  /** A problem with the file as a whole — bad headers, no active stage, too many rows. */
  error: string | null;
  /** Slash dates in the mapped date columns. Absent when no column maps to a date, or the file could not be planned. */
  dates?: ImportDateScan;
};

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLocaleLowerCase();
}

/** The minimum identity fields needed to stage an imported lead for review. */
export function isRequiredLeadImportField(field: Pick<TemplateField, "field_key" | "type">) {
  return isPhoneTemplateField(field) || ["first_name", "last_name"].includes(field.field_key);
}

function compactHeader(value: string) {
  return normalizedHeader(value).replace(/[^a-z0-9]/g, "");
}

export type ImportColumnSuggestion = {
  header: string;
  fieldKey: string | null;
  confidence: "exact" | "alias" | "fuzzy" | "unmapped";
};

/** Keeps persisted mappings small, stable, and tied to the current template contract. */
export function sanitizeImportMapping(mapping: unknown, fields: TemplateField[]): Record<string, string | null> {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error("Import mapping must be an object");
  const fieldKeys = new Set(fields.map((field) => field.field_key));
  const output: Record<string, string | null> = {};
  for (const [rawHeader, rawField] of Object.entries(mapping as Record<string, unknown>)) {
    const header = normalizedHeader(rawHeader);
    if (!header) throw new Error("Import mapping headers cannot be empty");
    if (rawField !== null && typeof rawField !== "string") throw new Error(`Import mapping for ${header} is invalid`);
    if (typeof rawField === "string" && !fieldKeys.has(rawField)) throw new Error(`Import mapping references an unknown field: ${rawField}`);
    output[header] = rawField;
  }
  return output;
}

export function normalizeImportMapping(mapping: unknown, headers: string[], fields: TemplateField[]): Record<string, string | null> {
  const sanitized = sanitizeImportMapping(mapping, fields);
  const headerSet = new Set(headers.map(normalizedHeader));
  for (const header of Object.keys(sanitized)) if (!headerSet.has(header)) throw new Error(`Import mapping references a header that is not in this file: ${header}`);
  return sanitized;
}

const COMMON_IMPORT_ALIASES: Record<string, string[]> = {
  first_name: ["firstname", "givenname", "fname"],
  last_name: ["lastname", "familyname", "surname", "lname"],
  phone: ["phonenumber", "mobile", "mobilephone", "cell", "cellphone"],
  phone_number: ["phone", "phonenumber", "mobile", "mobilephone", "cell", "cellphone"],
  date_of_birth: ["dob", "birthdate", "dateofbirth"],
  dob: ["dateofbirth", "birthdate"],
  postal_code: ["zipcode", "zip", "postalcode", "postcode"],
  zip: ["zipcode", "postalcode", "postcode"],
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1] ? diagonal : Math.min(diagonal, above, previous[column - 1]) + 1;
      diagonal = above;
    }
  }
  return previous[right.length];
}

/** Suggests safe, reviewable mappings while leaving vendor-specific columns available as unmapped. */
export function suggestLeadCsvMappings(headers: string[], fields: TemplateField[]): ImportColumnSuggestion[] {
  const candidates = fields.map((field) => ({ field, key: compactHeader(field.field_key), label: compactHeader(field.label) }));
  return headers.map((header) => {
    const normalized = normalizedHeader(header);
    if (normalized === "stage") return { header: normalized, fieldKey: null, confidence: "exact" };
    const exact = candidates.find((candidate) => candidate.key === compactHeader(normalized) || candidate.label === compactHeader(normalized));
    if (exact) return { header: normalized, fieldKey: exact.field.field_key, confidence: "exact" };
    const aliasMatches = candidates.filter((candidate) => COMMON_IMPORT_ALIASES[candidate.field.field_key]?.includes(compactHeader(normalized)));
    if (aliasMatches.length === 1) return { header: normalized, fieldKey: aliasMatches[0].field.field_key, confidence: "alias" };
    const fuzzyMatches = candidates.filter((candidate) => editDistance(compactHeader(normalized), candidate.key) <= 2 || editDistance(compactHeader(normalized), candidate.label) <= 2);
    return fuzzyMatches.length === 1 ? { header: normalized, fieldKey: fuzzyMatches[0].field.field_key, confidence: "fuzzy" } : { header: normalized, fieldKey: null, confidence: "unmapped" };
  });
}

function parseValue(field: TemplateField, raw: string, rowNumber: number): unknown {
  const value = raw.trim();
  if (!value) return undefined;

  if (["number", "currency"].includes(field.type)) {
    const numberValue = Number(value);
    const valid = Number.isFinite(numberValue) && (field.type !== "currency" || Number.isInteger(numberValue));
    if (!valid) throw new Error(`Row ${rowNumber}: ${field.label} must be a valid ${field.type === "currency" ? "integer-cent amount" : "number"}`);
    return numberValue;
  }

  if (field.type === "boolean") {
    const normalized = value.toLocaleLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
    throw new Error(`Row ${rowNumber}: ${field.label} must be true or false`);
  }

  if (field.type === "multi_select") {
    const values = value.includes("|") ? value.split("|") : value.split(",");
    return values.map((item) => item.trim()).filter(Boolean);
  }

  return value;
}

function fieldHeaders(fields: TemplateField[]) {
  const byHeader = new Map<string, TemplateField>();
  for (const field of fields) {
    for (const header of [field.field_key, field.label]) {
      const key = normalizedHeader(header);
      if (!key) continue;
      const existing = byHeader.get(key);
      if (existing && existing.field_key !== field.field_key) throw new Error(`Field labels must be unique before importing CSV (${existing.label} and ${field.label})`);
      byHeader.set(key, field);
    }
  }
  return byHeader;
}

/**
 * Resolves the header row, the column-to-field plan and the stage lookup, once per file.
 *
 * Split out of `parseLeadCsv` so the preview and the write path can share it without parsing the
 * file twice. The preview used to call `parseCsv` itself and then call `parseLeadCsv`, which called
 * `parseCsv` again — two full passes per invocation, and the component invoked it on every render.
 * At the 20,000 rows criterion 6 asks for, that is what exhausted the browser.
 *
 * Throws on anything wrong with the file as a whole, which is what both callers want: a missing
 * no active pipeline stage is not a row-level problem and there is no point examining rows.
 */
/** Field keys `normalizeImportValues` reads as a date of birth. */
const DATE_OF_BIRTH_KEYS = ["date_of_birth", "dob"];

/** Whether a template field holds a date the parser reads, and so whether its column needs a date order. */
export function isImportDateField(field: Pick<TemplateField, "field_key" | "type">) {
  return field.type === "date" || DATE_OF_BIRTH_KEYS.includes(field.field_key);
}

function leadCsvPlan(rows: string[][], fields: TemplateField[], stages: ImportStage[], columnMapping?: Record<string, string | null>, dateOrder?: ImportDateOrder | null) {
  if (rows.length < 2) throw new Error("CSV needs a header and at least one lead");
  if (rows.length - 1 > MAX_LEAD_IMPORT_ROWS) throw new Error(`CSV cannot contain more than ${MAX_LEAD_IMPORT_ROWS.toLocaleString()} leads`);

  const headers = rows[0].map(normalizedHeader);
  if (headers.some((header) => !header)) throw new Error("CSV headers cannot be empty");
  if (new Set(headers).size !== headers.length) throw new Error("CSV headers cannot be duplicated");
  const stageIndex = headers.indexOf("stage");

  const byHeader = fieldHeaders(fields);
  const fieldByKey = new Map(fields.map((field) => [field.field_key, field]));
  const normalizedMapping = columnMapping ? normalizeImportMapping(columnMapping, headers, fields) : null;
  const columns = headers.map((header, index) => ({ header, index, field: index === stageIndex ? null : normalizedMapping && Object.prototype.hasOwnProperty.call(normalizedMapping, header) ? fieldByKey.get(normalizedMapping[header] ?? "") : byHeader.get(header) }));
  const mappedKeys = columns.flatMap((column) => column.field ? [column.field.field_key] : []);
  if (new Set(mappedKeys).size !== mappedKeys.length) throw new Error("CSV cannot map multiple columns to the same field");
  // Vendor exports commonly include identifiers, timezone labels, product names, and notes that
  // are not part of this tenant's lead template. They remain visible as Unmapped in the review UI
  // but are intentionally ignored so an identity-complete row can continue through preflight.

  const activeStages = stages.filter((stage) => !stage.is_archived);
  if (!activeStages.length) throw new Error("No active pipeline stages are available for this import");
  const defaultStage = activeStages[0];
  const phoneField = fields.find(isPhoneTemplateField);
  if (phoneField) {
    const missingTemplateFields = ["first_name", "last_name"].filter(
      (key) => !fields.some((field) => field.field_key === key),
    );
    if (missingTemplateFields.length) throw new Error(`Import template is missing required fields: ${missingTemplateFields.join(", ")}`);
  }
  const requiredFields = fields.filter(isRequiredLeadImportField);
  const stageByName = new Map<string, ImportStage>();
  for (const stage of activeStages) {
    const key = normalizedHeader(stage.name);
    if (stageByName.has(key)) throw new Error(`Pipeline stage names must be unique before importing CSV (${stage.name})`);
    stageByName.set(key, stage);
  }
  const stageById = new Map(activeStages.map((stage) => [normalizedHeader(stage.id), stage]));

  /** Maps one data row, or throws with that row's number. The single definition of a lead row. */
  function mapRow(values: string[], rowNumber: number): LeadImportRow {
    const stageValue = stageIndex >= 0 ? values[stageIndex]?.trim() ?? "" : "";
    const stage = stageIndex < 0
      ? defaultStage
      : stageByName.get(normalizedHeader(stageValue)) ?? stageById.get(normalizedHeader(stageValue));
    if (!stage) throw new Error(`Row ${rowNumber}: choose an active pipeline stage`);

    const leadValues: Record<string, unknown> = {};
    for (const column of columns) {
      if (!column.field) continue;
      const raw = values[column.index] ?? "";
      let parsed = parseValue(column.field, raw, rowNumber);
      // A date-type field other than the date of birth (which `normalizeImportValues` owns) is read
      // with the file's date order once one was chosen. Without an order it is left exactly as it
      // was, so nothing changes for a caller that never picks one.
      if (dateOrder && typeof parsed === "string" && column.field.type === "date" && !DATE_OF_BIRTH_KEYS.includes(column.field.field_key))
        parsed = normalizeImportDate(parsed, dateOrder) ?? parsed;
      if (parsed !== undefined) leadValues[column.field.field_key] = parsed;
    }
    for (const requiredField of requiredFields) {
      const value = leadValues[requiredField.field_key];
      if (value === undefined || value === null || value === "") throw new Error(`Row ${rowNumber}: ${requiredField.label} is required`);
    }
    return { rowNumber, stageId: stage.id, values: normalizeImportValues(leadValues, rowNumber, dateOrder) };
  }

  const dateColumns = columns.filter((column) => column.field && isImportDateField(column.field));
  return { mapRow, dateColumns };
}

export type LeadCsvRowError = {
  rowNumber: number;
  message: string;
  /** `invalid_phone` when the only problem is a phone that is not a US number; otherwise `unreadable`. */
  kind: "invalid_phone" | "unreadable";
};

/**
 * Parses every row it can and reports the ones it cannot, instead of stopping at the first.
 *
 * `parseLeadCsv` is fail-fast because the write path must be: LA-2.2 criterion 3 is that a failure
 * at any step leaves zero rows imported. The PREFLIGHT wants the opposite — Module 2 step ④ is
 * "show him what is wrong BEFORE he commits", and a preflight that stops at row 14 cannot show him
 * anything about row 15. Both share one row mapper, so the two views of a file can never disagree
 * about what a row means.
 */
export function parseLeadCsvRows(text: string, fields: TemplateField[], stages: ImportStage[], columnMapping?: Record<string, string | null>, dateOrder?: ImportDateOrder | null): { rows: LeadImportRow[]; errors: LeadCsvRowError[] } {
  const raw = parseCsv(text);
  const { mapRow } = leadCsvPlan(raw, fields, stages, columnMapping, dateOrder);
  const rows: LeadImportRow[] = [];
  const errors: LeadCsvRowError[] = [];
  for (let index = 1; index < raw.length; index++) {
    const rowNumber = index + 1;
    try {
      rows.push(mapRow(raw[index], rowNumber));
    } catch (error) {
      errors.push({
        rowNumber,
        message: error instanceof Error ? error.message : "This row needs correction",
        kind: error instanceof LeadImportPhoneError ? "invalid_phone" : "unreadable",
      });
    }
  }
  return { rows, errors };
}

export function parseLeadCsv(text: string, fields: TemplateField[], stages: ImportStage[], columnMapping?: Record<string, string | null>, dateOrder?: ImportDateOrder | null): LeadImportRow[] {
  const rows = parseCsv(text);
  const { mapRow } = leadCsvPlan(rows, fields, stages, columnMapping, dateOrder);
  // Fail-fast on the write path. A row this parser cannot read must stop the import, because
  // criterion 3 is that a failure at any step leaves zero rows imported.
  return rows.slice(1).map((values, rowIndex) => mapRow(values, rowIndex + 2));
}

/**
 * Runs the same row mapper as the write path so the browser can show a truthful preflight.
 *
 * Counts rather than collects. The mapped row objects are deliberately discarded: the screen shows
 * a handful of raw lines and a total, so retaining 20,000 typed objects to render three of them is
 * pure cost. This is the difference between a 20,000-row preview that works and one that does not.
 */
export function previewLeadCsv(text: string, fields: TemplateField[], stages: ImportStage[], columnMapping?: Record<string, string | null>, maxRowErrors = 8, dateOrder?: ImportDateOrder | null): LeadImportPreview {
  const empty = { totalRows: 0, validRows: 0, rejectedRows: 0, rowErrors: [], moreRowErrors: 0 };
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : "This file needs correction before import" };
  }
  const totalRows = Math.max(0, rows.length - 1);

  let plan: ReturnType<typeof leadCsvPlan>;
  try {
    plan = leadCsvPlan(rows, fields, stages, columnMapping, dateOrder);
  } catch (error) {
    // A whole-file problem. Every row is unusable, and saying so is more honest than reporting
    // per-row errors for a file whose headers were never understood.
    return { totalRows, validRows: 0, rejectedRows: totalRows, rowErrors: [], moreRowErrors: 0, error: error instanceof Error ? error.message : "This file needs correction before import" };
  }

  let validRows = 0;
  const rowErrors: Array<{ rowNumber: number; message: string }> = [];
  let moreRowErrors = 0;
  // The WHOLE file, in the same pass: a date order picked from the first rows would be a guess
  // about row 14,000.
  const dates: ImportDateScan = { ...EMPTY_DATE_SCAN, ambiguousByHeader: {} };
  for (let index = 1; index < rows.length; index++) {
    const rowNumber = index + 1;
    for (const column of plan.dateColumns) scanDateValue(dates, column.header, rows[index][column.index] ?? "");
    try {
      plan.mapRow(rows[index], rowNumber);
      validRows++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "This row needs correction";
      if (rowErrors.length < maxRowErrors) rowErrors.push({ rowNumber, message });
      else moreRowErrors++;
    }
  }
  return { totalRows, validRows, rejectedRows: totalRows - validRows, rowErrors, moreRowErrors, error: null, ...(plan.dateColumns.length ? { dates } : {}) };
}
