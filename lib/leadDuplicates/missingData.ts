// Client-safe: Clean › Missing data and its route share these (the service is server-only).
import { parseCsv } from "../contacts/csv.ts";
import { csvCell, csvUnguard } from "../csv/cell.ts";
import { STATE_CODES } from "../appointments/constants.ts";

/**
 * Clean › Missing data (board LirK2, owner 2026-10-29): the leads that miss a phone, a state, a date
 * of birth or an address, each empty cell typed into in place, set for many at once, or fixed in a
 * downloaded file and uploaded back (matched by lead id). Edits are held until Save, which writes
 * through the lead edit (updateAgentLead), so a new phone number is screened like any other edit.
 */

export type MissingColumn = "phone" | "state" | "dob" | "address";
export type MissingFilter = "any" | MissingColumn;

/** The value keys import and the dialer read for each column, in the order they are looked up. */
export const MISSING_COLUMNS: ReadonlyArray<{ key: MissingColumn; label: string; keys: readonly string[] }> = [
  { key: "phone", label: "Phone", keys: ["phone", "phone_number"] },
  { key: "state", label: "State", keys: ["state", "state_code"] },
  { key: "dob", label: "Date of birth", keys: ["dob", "date_of_birth"] },
  { key: "address", label: "Address", keys: ["address_line1", "address", "street_address"] },
];

export const MISSING_FILTERS: readonly MissingFilter[] = ["any", "phone", "state", "dob", "address"];

export function missingFilterOf(value: unknown): MissingFilter {
  return MISSING_FILTERS.includes(value as MissingFilter) ? value as MissingFilter : "any";
}

export type MissingDataRow = {
  id: string;
  name: string;
  campaignId: string | null;
  campaign: string | null;
  /** Null: the lead misses it. */
  phone: string | null;
  state: string | null;
  dob: string | null;
  address: string | null;
  /** False when the lead was made on another lead form than yours, so the edit would be refused. */
  editable: boolean;
};

export type MissingDataPage = {
  rows: MissingDataRow[];
  /** Null when the count could not be taken in time. */
  total: number | null;
  page: number;
  pageSize: number;
  campaigns: Array<{ id: string; name: string }>;
  /** Whether your lead form has a field for the column; one it does not have cannot be filled here. */
  editable: Record<MissingColumn, boolean>;
};

/** Leads missing each field (`?counts=1`); null where the count could not be taken in time. */
export type MissingCounts = Record<MissingColumn, number | null>;

/**
 * The order Clean asks for fixes in (owner 2026-10-30): state first, because a lead without one cannot
 * be called (calling hours and licensing are by state), then phone, date of birth, address.
 */
export const MISSING_FIX_ORDER: readonly MissingColumn[] = ["state", "phone", "dob", "address"];

/** What each missing field stops, in the "next up" sentence. */
export const MISSING_BLOCKS: Record<MissingColumn, { noun: string; stops: string; action: string }> = {
  state: { noun: "state", stops: "so they can't be called", action: "Fill in states" },
  phone: { noun: "phone number", stops: "so they can't be dialled", action: "Fill in phones" },
  dob: { noun: "date of birth", stops: "which a quote needs", action: "Fill in dates of birth" },
  address: { noun: "address", stops: "which an application needs", action: "Fill in addresses" },
};

/** The first field in fix order that some leads miss; null when none do or nothing could be counted. */
export function firstMissing(counts: MissingCounts | null | undefined): { column: MissingColumn; count: number } | null {
  if (!counts) return null;
  for (const column of MISSING_FIX_ORDER) {
    const count = counts[column];
    if (typeof count === "number" && count > 0) return { column, count };
  }
  return null;
}

export type MissingEdits = Record<string, Partial<Record<MissingColumn, string>>>;

export type MissingSaveResult = { saved: string[]; failed: Array<{ leadId: string; error: string }> };

export const MISSING_SAVE_LIMIT = 500;
export const MISSING_DOWNLOAD_LIMIT = 5000;

/** The first non-empty value under any of the keys. */
export function valueUnder(values: Record<string, unknown> | null | undefined, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = values?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

/**
 * The PostgREST `or` filter for the leads that miss a column: every one of its keys absent or empty.
 * `any` is the union of the four. The keys are constants, never user input.
 */
export function missingOrFilter(filter: MissingFilter): string {
  const group = (keys: readonly string[]) => `and(${keys.map((key) => `or(values->>${key}.is.null,values->>${key}.eq."")`).join(",")})`;
  const columns = filter === "any" ? MISSING_COLUMNS : MISSING_COLUMNS.filter((column) => column.key === filter);
  return columns.map((column) => group(column.keys)).join(",");
}

/**
 * A typed value, checked and put in the shape the lead form stores: phone as its 10 digits, state as
 * the USPS code, date of birth as YYYY-MM-DD (MM/DD/YYYY is accepted), address trimmed.
 */
export function normalizeMissingValue(column: MissingColumn, raw: string, today = new Date()): { value: string } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "Enter a value" };
  if (column === "phone") {
    let digits = text.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    return digits.length === 10 ? { value: digits } : { error: "A phone number has 10 digits" };
  }
  if (column === "state") {
    const code = text.toUpperCase();
    return (STATE_CODES as readonly string[]).includes(code) ? { value: code } : { error: "Use a two-letter state code" };
  }
  if (column === "dob") {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const [year, month, day] = us ? [Number(us[3]), Number(us[1]), Number(us[2])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!year || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: "Use MM/DD/YYYY" };
    if (date.getTime() > today.getTime() || year < 1900) return { error: "That date of birth is not possible" };
    return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }
  return text.length > 200 ? { error: "That address is too long" } : { value: text };
}

/** How a stored value reads in the table. */
export function displayMissingValue(column: MissingColumn, value: string | null): string {
  if (!value) return "";
  if (column === "phone") {
    const digits = value.replace(/\D/g, "").slice(-10);
    return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value;
  }
  if (column === "dob") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
  }
  return value;
}

export const MISSING_CSV_HEADER = ["lead_id", "name", "phone", "state", "date_of_birth", "address", "campaign"] as const;
const CSV_COLUMN: Record<string, MissingColumn> = { phone: "phone", state: "state", date_of_birth: "dob", address: "address" };

/** The download: the filtered rows, with the lead id the upload matches on. */
export function missingDataCsv(rows: readonly MissingDataRow[]): string {
  const lines = [MISSING_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push([row.id, row.name, displayMissingValue("phone", row.phone), row.state ?? "", displayMissingValue("dob", row.dob), row.address ?? "", row.campaign ?? ""].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * The upload: the values a fixed file fills in, by lead id. Only cells that are filled in the file are
 * taken; the server still refuses a column the lead already has. Errors name the file's row.
 */
export function parseMissingDataCsv(text: string): { edits: MissingEdits; names: Record<string, string>; errors: string[] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new Error("The file needs a header and at least one lead");
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const idAt = header.indexOf("lead_id");
  if (idAt < 0) throw new Error("The file needs its lead_id column: download the file again and fill it in");
  if (rows.length - 1 > MISSING_DOWNLOAD_LIMIT) throw new Error(`Upload at most ${MISSING_DOWNLOAD_LIMIT.toLocaleString()} leads at a time`);
  const nameAt = header.indexOf("name");
  const edits: MissingEdits = {};
  const names: Record<string, string> = {};
  const errors: string[] = [];
  rows.slice(1).forEach((cells, at) => {
    const rowNumber = at + 2;
    const leadId = (cells[idAt] ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) { errors.push(`Row ${rowNumber}: no lead id`); return; }
    const values: Partial<Record<MissingColumn, string>> = {};
    header.forEach((name, index) => {
      const column = CSV_COLUMN[name];
      const raw = csvUnguard((cells[index] ?? "").trim());
      if (!column || !raw) return;
      const checked = normalizeMissingValue(column, raw);
      if ("error" in checked) errors.push(`Row ${rowNumber}, ${name}: ${checked.error}`);
      else values[column] = checked.value;
    });
    if (Object.keys(values).length) {
      edits[leadId] = { ...edits[leadId], ...values };
      if (nameAt >= 0 && cells[nameAt]) names[leadId] = csvUnguard(cells[nameAt].trim());
    }
  });
  return { edits, names, errors };
}

export function countMissingEdits(edits: MissingEdits): number {
  return Object.values(edits).reduce((sum, values) => sum + Object.keys(values).length, 0);
}
