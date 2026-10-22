/**
 * LA-7.6 (Notion sprint, Module 7 — Accounting) · bank CSV import, with no database.
 *
 * Every bank's export differs, so each account remembers its column mapping. A row becomes a bank
 * line with signed cents (deposits positive), the bank's text verbatim, and a content hash — of the
 * account, date, amount, text, reference and the row's OCCURRENCE among identical rows in the file,
 * so two identical $50 lines on one day stay two lines, and re-importing January-to-now adds only
 * what is new. Amounts and dates use the carrier-statement parsers (LA-4): string arithmetic only.
 */

import { createHash } from "node:crypto";

import { parseCsv } from "../contacts/csv.ts";
import { parseAmountCents, parseStatementDate } from "../ledger/statementParse.ts";

export { MATCH_STATUS_LABELS, type MatchStatus } from "./bankLabels.ts";

export type ColumnMap = {
  date: string;
  /** One signed amount column … */
  amount?: string | null;
  /** … or two, money in and money out. */
  credit?: string | null;
  debit?: string | null;
  description: string;
  reference?: string | null;
  /** Some banks print deposits negative. */
  invert?: boolean;
};

export type BankRow = { posted_on: string; amount_cents: number; description_raw: string; reference: string | null; content_hash: string };

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A first guess at the mapping from the headers; the person confirms it once and it is remembered. */
export function suggestColumnMap(headers: string[]): ColumnMap | null {
  // Names in priority order: an exact "description" beats a "details" column that only says CREDIT.
  const find = (...names: string[]) => {
    for (const n of names) { const h = headers.find((x) => norm(x) === n); if (h) return h; }
    for (const n of names) { const h = headers.find((x) => norm(x).includes(n)); if (h) return h; }
    return null;
  };
  const date = find("posting date", "posted date", "date posted", "transaction date", "date");
  const description = find("description", "details", "memo", "payee", "narrative");
  const amount = find("amount", "transaction amount");
  const credit = find("credit", "deposit", "deposits", "money in");
  const debit = find("debit", "withdrawal", "withdrawals", "money out");
  const reference = find("reference", "check number", "ref", "transaction id");
  if (!date || !description || (!amount && !(credit && debit))) return null;
  return { date, description, amount: amount && !(credit && debit) ? amount : null, credit: amount && !(credit && debit) ? null : credit, debit: amount && !(credit && debit) ? null : debit, reference, invert: false };
}

export function mappingProblem(map: ColumnMap | null, headers: string[]): string | null {
  if (!map) return "Choose which columns hold the date, the description and the amount.";
  const missing = [map.date, map.description, map.amount, map.credit, map.debit, map.reference].filter((c): c is string => !!c && !headers.includes(c));
  if (missing.length) return `This file has no column called ${missing.map((m) => `"${m}"`).join(", ")}.`;
  if (!map.amount && !(map.credit && map.debit)) return "Choose an amount column, or both a money-in and a money-out column.";
  return null;
}

export function contentHash(accountId: string, row: Omit<BankRow, "content_hash">, occurrence: number): string {
  return createHash("sha256").update([accountId, row.posted_on, row.amount_cents, row.description_raw, row.reference ?? "", occurrence].join("\u001f")).digest("hex");
}

/** Parse a bank export with an account's mapping. Rows that cannot be read are reported, never guessed. */
export function parseBankCsv(text: string, map: ColumnMap, accountId: string): { rows: BankRow[]; skipped: { line: number; reason: string }[]; headers: string[] } {
  const table = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (table[0] ?? []).map((h) => h.trim());
  const at = (name: string | null | undefined) => (name ? headers.indexOf(name) : -1);
  const di = at(map.date), ai = at(map.amount), ci = at(map.credit), bi = at(map.debit), si = at(map.description), ri = at(map.reference);
  const rows: BankRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const posted = parseStatementDate(r[di] ?? "");
    if (!posted) { skipped.push({ line: i + 1, reason: `The date "${r[di] ?? ""}" isn't one we can read.` }); continue; }
    let cents: number | null;
    if (ai >= 0) cents = parseAmountCents(r[ai] ?? "");
    else {
      const credit = (r[ci] ?? "").trim() ? parseAmountCents(r[ci]) : 0;
      const debit = (r[bi] ?? "").trim() ? parseAmountCents(r[bi]) : 0;
      cents = credit === null || debit === null ? null : Math.abs(credit) - Math.abs(debit);
    }
    if (cents === null) { skipped.push({ line: i + 1, reason: "The amount isn't a number of dollars and cents." }); continue; }
    if (map.invert) cents = -cents;
    const description = r[si] ?? "";
    if (!description.trim() && cents === 0) { skipped.push({ line: i + 1, reason: "An empty line." }); continue; }
    const base = { posted_on: posted, amount_cents: cents, description_raw: description, reference: ri >= 0 ? (r[ri] ?? "").trim() || null : null };
    const key = [base.posted_on, base.amount_cents, base.description_raw, base.reference ?? ""].join("\u001f");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    rows.push({ ...base, content_hash: contentHash(accountId, base, n) });
  }
  return { rows, skipped, headers };
}
