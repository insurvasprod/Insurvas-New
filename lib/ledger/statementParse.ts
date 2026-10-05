/**
 * Reading a carrier commission statement (CSV) into lines.
 *
 * The rules, stated once:
 *
 *   · every data row becomes a line, and keeps its cells verbatim (`raw`, header → cell) — the
 *     ledger's promise is that each entry keeps the statement it came from;
 *   · the amount is read to whole cents without floating point: "$1,234.56", "-12.00", "(12.00)"
 *     and "12.00-" are all understood; more than two decimals, or anything else, is an error on
 *     that line, never a rounding;
 *   · the kind comes from the mapped column when there is one (advance / commission / chargeback /
 *     adjustment, in the words carriers use); with no column, or an empty cell, a negative amount is
 *     a chargeback and a positive one commission. Words that name none of the four are an error;
 *   · a chargeback is always negative, whatever sign the carrier printed it with, so a sum over
 *     lines is the money that moved;
 *   · a row that cannot be read is kept with its error. It stays visible and never posts;
 *   · premium and rate (LA-4.3) are optional. A premium is read like an amount, always positive. A
 *     rate is read as basis points of premium: "110%" and "110" are 11,000; "1.10" is 11,000 too,
 *     because a bare number of 3 or less is a fraction of premium. A cell that names neither is an
 *     error on the line, as an unreadable date is.
 *
 * Pure and client-safe: the import dialog uses the header and suggestion helpers; the server parses
 * the whole file again on preview and on import.
 */
import { parseCsv } from "../contacts/csv.ts";
import {
  MAX_STATEMENT_LINES,
  REQUIRED_STATEMENT_FIELDS,
  STATEMENT_FIELDS,
  STATEMENT_FIELD_LABELS,
  type StatementField,
  type StatementLineKind,
  type StatementMapping,
} from "./statementConstants.ts";

export type ParsedStatementLine = {
  /** 1-based data row: the first row under the header is line 1. */
  lineNumber: number;
  raw: Record<string, string>;
  policyNumber: string | null;
  insuredName: string | null;
  amountCents: number | null;
  kind: StatementLineKind | null;
  /** Where the kind came from: the mapped column, or the amount's sign. */
  kindFrom: "column" | "sign" | null;
  lineDate: string | null;
  /** The premium the line was paid on, when the carrier shows it (LA-4.3). */
  premiumCents: number | null;
  /** The commission rate paid, in basis points of premium (110% = 11,000). */
  rateBp: number | null;
  error: string | null;
};

export type ParsedStatement = { headers: string[]; lines: ParsedStatementLine[] };

/** Header cells, trimmed, with blanks named by position and repeats numbered, so `raw` keys are unique. */
export function statementHeaders(cells: string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, index) => {
    const base = cell.replace(/^﻿/, "").trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/** Just the header row, for the mapping step — without parsing the whole file into lines. */
export function readStatementHeaders(text: string): string[] {
  const firstBreak = text.search(/\r?\n/);
  const head = firstBreak < 0 ? text : text.slice(0, firstBreak);
  let rows: string[][];
  try {
    rows = parseCsv(head);
  } catch {
    // A header cell with a line break inside quotes: only the whole file says where the row ends.
    rows = parseCsv(text);
  }
  return rows.length ? statementHeaders(rows[0]) : [];
}

/** Whole cents from a statement cell, or null when it is not a plain amount. */
export function parseAmountCents(input: string): number | null {
  let text = input.replace(/\s+/g, "").replace(/US\$|USD|\$/gi, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (text.length > 1 && text.endsWith("-")) { negative = !negative; text = text.slice(0, -1); }
  if (text.startsWith("-") || text.startsWith("+")) { if (text[0] === "-") negative = !negative; text = text.slice(1); }
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/.test(text) || text === "" || text === ".") return null;
  const [whole, fraction = ""] = text.replace(/,/g, "").split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD from the formats statements use: ISO, US M/D/YYYY (or -), and two-digit years. */
export function parseStatementDate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(text);
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return validDate(year, Number(us[1]), Number(us[2]));
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return null;
}

/** Basis points of premium from a rate cell ("110%", "110", "1.10"), or null when it is not a rate. */
export function parseRateBp(input: string): number | null {
  const text = input.replace(/\s+/g, "");
  if (!text) return null;
  const percent = text.endsWith("%");
  const number = percent ? text.slice(0, -1) : text;
  if (!/^\d+(?:\.\d+)?$/.test(number)) return null;
  const value = Number(number);
  const bp = Math.round(percent || value > 3 ? value * 100 : value * 10_000);
  return Number.isSafeInteger(bp) && bp <= 100_000 ? bp : null;
}

/**
 * The kind a carrier's wording names, or null for words that name none of the four. Chargeback is
 * checked first: "advance reversal" and "advance chargeback" take money back.
 */
export function parseStatementKind(input: string): StatementLineKind | null {
  const text = input.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!text) return null;
  if (/charge ?back|chbk|claw ?back|recapture|reversal|reversed|\breverse\b|debit|^cb$|^chb$|^rev$/.test(text)) return "chargeback";
  if (/advance|^adv\b/.test(text)) return "advance";
  if (/adjust|^adj\b|correction/.test(text)) return "adjustment";
  if (/commission|^comm?\b|renewal|^ren\b|first year|^fyc?$|earned|override|trail|as earned|heaped|credit/.test(text)) return "commission";
  return null;
}

const SUGGESTIONS: Record<StatementField, RegExp[]> = {
  policyNumber: [/^policy ?(no|num|number|#|id)\.?$/, /policy.*(no|num|number|#|id)/, /^policy$/, /^pol ?#?$/, /contract ?(no|num|number|#)/, /certificate/],
  amount: [/^(commission|comm) ?(amount|amt|paid)$/, /^(net )?(amount|amt)( paid)?$/, /(commission|comm).*(amount|amt|paid)/, /net (commission|paid|amount)/, /paid amount|payment amount/, /^commission$/, /amount|amt/],
  kind: [/^(transaction|trans|txn) ?(type|code)$/, /^(type|kind)$/, /(commission|comm) ?type/, /type|kind|category/, /description|memo/],
  lineDate: [/^(paid|payment|transaction|txn|posted|process(ed)?) ?date$/, /^date$/, /statement date/, /date/],
  insuredName: [/^insured( name)?$/, /insured/, /^(client|customer|owner)( name)?$/, /^name$/],
  premium: [/^(annual |modal |target |base )?premium( amount| amt)?$/, /premium/],
  rate: [/^(commission |comm )?(rate|pct|percent|%)$/, /(commission|comm).*(rate|pct|percent)/, /^rate$/],
};

/** A first guess at the mapping from header wording; each header is used at most once. */
export function suggestStatementMapping(headers: string[]): StatementMapping {
  const mapping: StatementMapping = {};
  const taken = new Set<string>();
  const key = (header: string) => header.toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
  for (const field of STATEMENT_FIELDS) {
    for (const pattern of SUGGESTIONS[field]) {
      const hit = headers.find((header) => !taken.has(header) && pattern.test(key(header)));
      if (hit) { mapping[field] = hit; taken.add(hit); break; }
    }
  }
  return mapping;
}

/** Only fields this module knows, pointing at headers this file has. */
export function sanitizeStatementMapping(mapping: unknown, headers: string[]): StatementMapping {
  const clean: StatementMapping = {};
  if (!mapping || typeof mapping !== "object") return clean;
  const available = new Set(headers);
  for (const field of STATEMENT_FIELDS) {
    const header = (mapping as Record<string, unknown>)[field];
    if (typeof header === "string" && available.has(header)) clean[field] = header;
  }
  return clean;
}

/** The first thing wrong with a mapping, in words; null when it can be imported. */
export function statementMappingProblem(mapping: StatementMapping, headers: string[]): string | null {
  for (const field of REQUIRED_STATEMENT_FIELDS) {
    const header = mapping[field];
    if (!header) return `Choose the column that holds the ${STATEMENT_FIELD_LABELS[field].label.toLowerCase()}.`;
    if (!headers.includes(header)) return `This file has no column named “${header}”.`;
  }
  const used = STATEMENT_FIELDS.map((field) => mapping[field]).filter(Boolean);
  if (new Set(used).size !== used.length) return "Each column can be used for one field only.";
  return null;
}

/** Every data row of the file, read with the mapping. Throws only for a file that cannot be read at all. */
export function parseStatementCsv(text: string, mapping: StatementMapping): ParsedStatement {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one line.");
  const headers = statementHeaders(rows[0]);
  const problem = statementMappingProblem(mapping, headers);
  if (problem) throw new Error(problem);
  const body = rows.slice(1);
  if (body.length > MAX_STATEMENT_LINES) throw new Error(`A statement can hold at most ${MAX_STATEMENT_LINES.toLocaleString("en-US")} lines; this file has ${body.length.toLocaleString("en-US")}.`);

  const column = (field: StatementField) => (mapping[field] ? headers.indexOf(mapping[field] as string) : -1);
  const at = { policyNumber: column("policyNumber"), amount: column("amount"), kind: column("kind"), lineDate: column("lineDate"), insuredName: column("insuredName"), premium: column("premium"), rate: column("rate") };

  const lines = body.map((cells, index): ParsedStatementLine => {
    const raw: Record<string, string> = {};
    headers.forEach((header, position) => { raw[header] = cells[position] ?? ""; });
    // Cells beyond the header are kept too: verbatim means nothing is dropped.
    for (let extra = headers.length; extra < cells.length; extra += 1) raw[`Column ${extra + 1}`] = cells[extra];
    const cell = (position: number) => (position < 0 ? "" : (cells[position] ?? "").trim());

    const errors: string[] = [];
    const policyNumber = cell(at.policyNumber).slice(0, 120) || null;
    const insuredName = cell(at.insuredName).slice(0, 200) || null;

    const amountText = cell(at.amount);
    let amountCents = parseAmountCents(amountText);
    if (!amountText) errors.push("No amount on this line.");
    else if (amountCents === null) errors.push(`“${amountText}” is not an amount.`);

    let kind: StatementLineKind | null = null;
    let kindFrom: ParsedStatementLine["kindFrom"] = null;
    const kindText = cell(at.kind);
    if (kindText) {
      kind = parseStatementKind(kindText);
      kindFrom = kind ? "column" : null;
      if (!kind) errors.push(`“${kindText}” is not advance, commission, chargeback or adjustment.`);
    } else if (amountCents !== null) {
      kind = amountCents < 0 ? "chargeback" : "commission";
      kindFrom = "sign";
    }
    if (kind === "chargeback" && amountCents !== null) amountCents = -Math.abs(amountCents);

    const dateText = cell(at.lineDate);
    const lineDate = dateText ? parseStatementDate(dateText) : null;
    if (dateText && !lineDate) errors.push(`“${dateText}” is not a date.`);

    const premiumText = cell(at.premium);
    const premiumRead = premiumText ? parseAmountCents(premiumText) : null;
    const premiumCents = premiumRead === null ? null : Math.abs(premiumRead);
    if (premiumText && premiumRead === null) errors.push(`“${premiumText}” is not a premium.`);

    const rateText = cell(at.rate);
    const rateBp = rateText ? parseRateBp(rateText) : null;
    if (rateText && rateBp === null) errors.push(`“${rateText}” is not a commission rate.`);

    const error = errors.length ? errors.join(" ") : null;
    return { lineNumber: index + 1, raw, policyNumber, insuredName, amountCents, kind, kindFrom, lineDate, premiumCents, rateBp, error };
  });

  return { headers, lines };
}
