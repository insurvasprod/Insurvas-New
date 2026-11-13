/**
 * LA-7.7 (Notion sprint, Module 7 — Accounting) · the P&L, with no database.
 *
 * Money in, acquisition cost, overhead, producer splits, net profit — and the two numbers the whole
 * module exists for: cost per issued policy and cost per PERSISTING policy, whose gap is the
 * chargeback tax. Integer cents throughout; a division rounds half up in integers.
 *
 * Rules carried here: reported and received are separate columns and are never summed; received
 * with no bank data is "not imported", never zero; only acquisition divides into cost per policy;
 * a persisting figure inside its horizon is "building", never a partial figure; under the sample
 * threshold the screen shows counts, not a per-policy rate.
 */

import { addMonths, wholeMonthsBetween } from "../ledger/compute.ts";
import type { Basis } from "./costLedgerCore";

export type PeriodKind = "month" | "quarter" | "year" | "custom";
export type Range = { from: string; to: string; label: string };

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymd = (y: number, m: number) => `${y}-${pad(m)}-01`;

/**
 * A period as a half-open date range [from, to). `anchor` is any date inside it. Quarters and years
 * follow the agency's financial year (fyStartMonth, 1–12); a year is named by the year it starts in.
 */
export function periodRange(kind: Exclude<PeriodKind, "custom">, anchor: string, fyStartMonth = 1): Range {
  const [y, m] = anchor.slice(0, 7).split("-").map(Number);
  if (kind === "month") return { from: ymd(y, m), to: addMonths(ymd(y, m), 1), label: `${MONTHS[m - 1]} ${y}` };
  const offset = (m - fyStartMonth + 12) % 12;
  const fyStart = addMonths(ymd(y, m), -offset);
  if (kind === "year") {
    const fy = Number(fyStart.slice(0, 4));
    return { from: fyStart, to: addMonths(fyStart, 12), label: fyStartMonth === 1 ? String(fy) : `Financial year ${fy}–${String(fy + 1).slice(2)}` };
  }
  const q = Math.floor(offset / 3);
  const from = addMonths(fyStart, q * 3);
  return { from, to: addMonths(from, 3), label: `Q${q + 1} ${fyStartMonth === 1 ? from.slice(0, 4) : `of the year from ${MONTHS[fyStartMonth - 1]} ${fyStart.slice(0, 4)}`}` };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date as people read it: "Aug 15, 2026" (round 7: dates readable, never 2026-08-15 on screen). */
export function readableDate(ymdText: string): string {
  const [y, m, d] = ymdText.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymdText;
  return `${SHORT_MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Nov 2026", for a month column or a six-month row. */
export function shortMonth(ym: string): string {
  return `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

export function customRange(from: string, toInclusive: string): Range | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(toInclusive) || toInclusive < from) return null;
  const to = new Date(Date.parse(`${toInclusive}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from, to, label: `${readableDate(from)} to ${readableDate(toInclusive)}` };
}

/** The period before, of the same length in months (or days, for a custom range), and the same period a year earlier. */
export function comparisons(kind: PeriodKind, r: Range): { previous: Range; lastYear: Range } {
  const lastYear = { from: addMonths(r.from, -12), to: addMonths(r.to, -12), label: "Same period last year" };
  if (kind === "custom") {
    const days = Math.trunc((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000);
    const from = new Date(Date.parse(r.from) - days * 86_400_000).toISOString().slice(0, 10);
    return { previous: { from, to: r.from, label: "Previous period" }, lastYear };
  }
  const months = kind === "month" ? 1 : kind === "quarter" ? 3 : 12;
  return { previous: { from: addMonths(r.from, -months), to: r.from, label: "Previous period" }, lastYear };
}

export type PnlLine = { section: "in" | "held" | "acquisition" | "overhead" | "splits"; entryType: string; sourceType: "partner" | "vendor" | "expense_category" | null; sourceId: string | null; sourceName: string | null; amountCents: number; entries: number };

export type Statement = {
  inCents: number;
  acquisitionCents: number;
  overheadCents: number;
  splitsCents: number;
  netProfitCents: number;
  /** Held by the carrier (LA-4.12): earned and acknowledged, not paid — shown apart, never in money in or net. */
  heldCents: number;
  in: PnlLine[];
  held: PnlLine[];
  acquisition: PnlLine[];
  overhead: PnlLine[];
  splits: PnlLine[];
};

const ORDER_IN = ["advance", "earned", "override", "held", "chargeback", "fee", "advance_interest", "reversal"];

export function statement(lines: PnlLine[]): Statement {
  const pick = (s: PnlLine["section"]) => lines.filter((l) => l.section === s);
  const sum = (ls: PnlLine[]) => ls.reduce((t, l) => t + l.amountCents, 0);
  const inLines = pick("in").sort((a, b) => ORDER_IN.indexOf(a.entryType) - ORDER_IN.indexOf(b.entryType));
  const acquisition = pick("acquisition").sort((a, b) => a.amountCents - b.amountCents);
  const overhead = pick("overhead").sort((a, b) => a.amountCents - b.amountCents);
  const splits = pick("splits");
  // Held money is never money in: an old reader that still files it under "in" is moved out here too.
  const held = lines.filter((l) => l.section === "held" || (l.section === "in" && l.entryType === "held"));
  const paidIn = inLines.filter((l) => !held.includes(l));
  const s = { in: paidIn, held, acquisition, overhead, splits, inCents: sum(paidIn), heldCents: sum(held), acquisitionCents: sum(acquisition), overheadCents: sum(overhead), splitsCents: sum(splits) };
  return { ...s, netProfitCents: s.inCents + s.acquisitionCents + s.overheadCents + s.splitsCents };
}

/**
 * Round 7 (owner 2026-11-10, mockups-r7/accounting.html 5·A): a full statement. Every line is filled across the
 * periods — this one, the one before, the same one last year — so a line is identified apart from its amount,
 * and the three periods' lines are merged on that identity. A line on one period only reads "—" in the others.
 */
export type PnlSection = PnlLine["section"];
export const SECTIONS: readonly PnlSection[] = ["in", "held", "acquisition", "overhead", "splits"];

/** A line's identity: its section, entry type and source (an expense line by its category). */
export function lineKey(l: Pick<PnlLine, "section" | "entryType" | "sourceType" | "sourceId" | "sourceName">): string {
  return [l.section, l.entryType, l.sourceType ?? "", l.sourceId ?? "", l.sourceType === "expense_category" ? l.sourceName ?? "" : ""].join("|");
}

/** What "In the bank" says for one line: an amount, "Not imported" (money in with no bank file), or "—" (it cannot be told honestly). */
export type InBank = { kind: "cents"; cents: number; paid: number; of: number } | { kind: "not_imported" } | { kind: "gap" };
export type StatementRow = { key: string; line: PnlLine; cur: number | null; prev: number | null; lastYear: number | null; bank: InBank };
export type StatementRows = Record<PnlSection, StatementRow[]>;

function sectioned(ls: PnlLine[]): Record<PnlSection, Map<string, PnlLine>> {
  const s = statement(ls);
  const out = Object.fromEntries(SECTIONS.map((k) => [k, new Map<string, PnlLine>()])) as Record<PnlSection, Map<string, PnlLine>>;
  for (const section of SECTIONS) {
    for (const l of s[section]) {
      // Held is its own section whatever an old reader filed it under.
      const line = { ...l, section };
      const key = lineKey(line);
      const had = out[section].get(key);
      // Two rows of one line (an expense booked against a partner) are one line here.
      out[section].set(key, had ? { ...had, amountCents: had.amountCents + line.amountCents, entries: had.entries + line.entries } : line);
    }
  }
  return out;
}

/**
 * The three periods' lines merged into one statement, in the statement's order: this period's lines as it sorts
 * them, then a line found only in the period before or last year, largest first. `bank` is filled by `inBankFor`.
 */
export function mergeStatement(cur: PnlLine[], prev: PnlLine[], lastYear: PnlLine[]): StatementRows {
  const [c, p, y] = [sectioned(cur), sectioned(prev), sectioned(lastYear)];
  const out = {} as StatementRows;
  for (const section of SECTIONS) {
    const rows: StatementRow[] = [];
    const seen = new Set<string>();
    for (const [key, line] of c[section]) { seen.add(key); rows.push({ key, line, cur: line.amountCents, prev: p[section].get(key)?.amountCents ?? null, lastYear: y[section].get(key)?.amountCents ?? null, bank: { kind: "gap" } }); }
    const rest: StatementRow[] = [];
    for (const source of [p[section], y[section]]) {
      for (const [key, line] of source) {
        if (seen.has(key)) continue;
        seen.add(key);
        rest.push({ key, line: { ...line, amountCents: 0, entries: 0 }, cur: null, prev: p[section].get(key)?.amountCents ?? null, lastYear: y[section].get(key)?.amountCents ?? null, bank: { kind: "gap" } });
      }
    }
    if (section === "in" || section === "held") rest.sort((a, b) => ORDER_IN.indexOf(a.line.entryType) - ORDER_IN.indexOf(b.line.entryType));
    else rest.sort((a, b) => (a.prev ?? a.lastYear ?? 0) - (b.prev ?? b.lastYear ?? 0));
    out[section] = [...rows, ...rest];
  }
  return out;
}

/** Every line of the statement, top to bottom: the order ‹ › walks on a line's entries page. */
export function statementOrder(rows: StatementRows): StatementRow[] {
  return SECTIONS.flatMap((s) => rows[s]);
}

/** This period less the period before; a missing side counts as nothing, both missing is no change to show. */
export function changeOf(cur: number | null, prev: number | null): number | null {
  if (cur === null && prev === null) return null;
  return (cur ?? 0) - (prev ?? 0);
}

/**
 * The change's colour. Costs are negative, so one rule fits every line: up is good (income grew, a cost shrank),
 * down is bad (a cost grew, income fell). A per-policy cost is positive, so it reads the other way (`costUp`).
 */
export function changeTone(delta: number | null, costUp = false): "good" | "bad" | "none" {
  if (!delta) return "none";
  const up = delta > 0;
  return up !== costUp ? "good" : "bad";
}

/** One paid cost entry, as cost_entry and its expense hold it: enough to place it on its statement line. */
export type PaidCost = { entryType: string; amountCents: number; vendorId: string | null; partnerId: string | null; expenseId: string | null; expenseCategory: string | null; expenseAcquisition: boolean | null };

/** The statement line a cost entry is on: public.pnl_section and pnl_lines' source rules, the same cases in the same order. */
export function costLineOf(c: PaidCost): Pick<PnlLine, "section" | "entryType" | "sourceType" | "sourceId" | "sourceName"> {
  const section: PnlSection = c.entryType === "producer_split" ? "splits"
    : c.expenseId ? (c.expenseAcquisition === true ? "acquisition" : "overhead")
    : ["lead_cost", "partner_payout", "platform_fee", "tool_subscription"].includes(c.entryType) ? "acquisition"
    : c.entryType === "refund" && (c.vendorId || c.partnerId) ? "acquisition"
    : "overhead";
  const sourced = section === "acquisition" && ["lead_cost", "partner_payout", "refund"].includes(c.entryType);
  const sourceType = sourced && c.partnerId ? "partner" : sourced && c.vendorId ? "vendor" : c.expenseId ? "expense_category" : null;
  return { section, entryType: c.entryType, sourceType, sourceId: sourced ? c.partnerId ?? c.vendorId : null, sourceName: c.expenseId ? c.expenseCategory : null };
}

/** The paid entries of a period, summed per statement line. */
export function paidByLine(costs: PaidCost[]): Map<string, { cents: number; count: number }> {
  const out = new Map<string, { cents: number; count: number }>();
  for (const c of costs) {
    const key = lineKey(costLineOf(c));
    const had = out.get(key) ?? { cents: 0, count: 0 };
    out.set(key, { cents: had.cents + c.amountCents, count: had.count + 1 });
  }
  return out;
}

/**
 * "In the bank" for one line this period (5·A: commission received and costs paid; never $0 for no bank file).
 * Money in: the bank matches whole carrier statements, not entry types, so a line has no honest share of it —
 * "—" on the line (the total sits on Net commission), or "Not imported" when no bank file covers the period.
 * A cost on cash basis is the cost itself (cash counts the day it was paid); on accrual it is the paid part of
 * the line's entries, or "—" when the paid entries could not be read.
 */
export function inBankFor(row: Pick<StatementRow, "key" | "line" | "cur">, basis: Basis, received: MoneyIn["received"], paid: Map<string, { cents: number; count: number }> | null): InBank {
  if (row.line.section === "in" || row.line.section === "held") return received.imported ? { kind: "gap" } : { kind: "not_imported" };
  if (row.cur === null) return { kind: "gap" };
  if (basis === "cash") return { kind: "cents", cents: row.cur, paid: row.line.entries, of: row.line.entries };
  if (!paid) return { kind: "gap" };
  const p = paid.get(row.key) ?? { cents: 0, count: 0 };
  return { kind: "cents", cents: p.cents, paid: p.count, of: row.line.entries };
}

/** A section's "In the bank" total, or null when any of its lines cannot say. */
export function inBankTotal(rows: StatementRow[]): number | null {
  let total = 0;
  for (const r of rows) {
    if (r.cur === null) continue;
    if (r.bank.kind !== "cents") return null;
    total += r.bank.cents;
  }
  return total;
}

/** The words for one period's kind: "month" → "This month" / "Month before" / "the month before". */
export function periodWords(kind: PeriodKind): { current: string; previous: string; before: string } {
  if (kind === "custom") return { current: "This period", previous: "Period before", before: "the period before" };
  const cap = kind[0].toUpperCase() + kind.slice(1);
  return { current: `This ${kind}`, previous: `${cap} before`, before: `the ${kind} before` };
}

/** The last-year column's heading: the period's own name a year back ("Nov 2025", "Q4 2025", "2025"). */
export function lastYearLabel(kind: PeriodKind, lastYear: Range, fyStartMonth = 1): string {
  if (kind === "month") return shortMonth(lastYear.from);
  if (kind === "custom") return "Last year";
  return periodRange(kind, lastYear.from, fyStartMonth).label;
}

/** A comparison period by its own name ("October 2026", "Q3 2026", "Jul 29, 2026 to Aug 14, 2026"), never "Previous period". */
export function namedRange(kind: PeriodKind, r: Range, fyStartMonth = 1): string {
  if (kind !== "custom") return periodRange(kind, r.from, fyStartMonth).label;
  const last = new Date(Date.parse(`${r.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${readableDate(r.from)} to ${readableDate(last)}`;
}

/** Integer division rounding half up (cents ÷ policies). No float. */
export function divideCents(cents: number, by: number): number {
  return Math.floor((2 * cents + by) / (2 * by));
}

export type PerPolicy =
  | { kind: "rate"; cents: number; policies: number }
  | { kind: "counts"; spendCents: number; policies: number }
  | { kind: "none" };

/** Acquisition (a negative ledger sum) per policy — or, under the threshold, the two counts. */
export function perPolicy(acquisitionCents: number, policies: number, threshold: number): PerPolicy {
  const spend = -acquisitionCents;
  if (policies <= 0) return { kind: "none" };
  if (policies < threshold) return { kind: "counts", spendCents: spend, policies };
  return { kind: "rate", cents: divideCents(spend, policies), policies };
}

export type Persisting =
  | { kind: "building"; horizon: number; monthsElapsed: number; readyOn: string }
  | { kind: "figure"; horizon: number; issued: number; alive: number; perPolicy: PerPolicy };

/**
 * Cost per persisting policy: acquisition ÷ the period's policies still paying at month N. Inside
 * the horizon (the period's last day plus N months is after today) it is building, with months elapsed.
 */
export function persisting(input: { range: Range; horizon: number; today: string; acquisitionCents: number; issued: number; alive: number; cohortBuilding: boolean; threshold: number }): Persisting {
  const lastDay = new Date(Date.parse(`${input.range.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const readyOn = addMonths(lastDay, input.horizon);
  if (readyOn > input.today || input.cohortBuilding) {
    return { kind: "building", horizon: input.horizon, monthsElapsed: wholeMonthsBetween(input.range.from, input.today), readyOn };
  }
  return { kind: "figure", horizon: input.horizon, issued: input.issued, alive: input.alive, perPolicy: perPolicy(input.acquisitionCents, input.alive, input.threshold) };
}

/** The chargeback tax: what a policy that lasts really costs, over what an issued one seems to. */
export function chargebackTax(issued: PerPolicy, lasting: Persisting): number | null {
  if (issued.kind !== "rate" || lasting.kind !== "figure" || lasting.perPolicy.kind !== "rate") return null;
  return lasting.perPolicy.cents - issued.cents;
}

/** Reported is the carriers' word, received the bank's. Never one number: received may be unknown. */
export type MoneyIn = { reportedCents: number; received: { imported: false } | { imported: true; cents: number } };

export function moneyIn(reportedCents: number, receivedCents: number | null): MoneyIn {
  return { reportedCents, received: receivedCents === null ? { imported: false } : { imported: true, cents: receivedCents } };
}

export const BASIS_NOTE: Record<Basis, string> = {
  accrual: "Accrual: each cost in the month it bought, each commission on its transaction date.",
  cash: "Cash: each cost on the day it was paid, each commission on the carrier's statement date.",
};

export const IN_LABELS: Record<string, string> = {
  advance: "Commission advances",
  earned: "Earned & renewals",
  override: "Overrides",
  held: "Held by the carrier",
  chargeback: "Chargebacks",
  fee: "Carrier fees",
  advance_interest: "Advance interest",
  reversal: "Corrections",
};

/** The period the screen asks for, from its query string; this month on the agency's basis by default. */
export function resolvePeriod(q: { kind?: string | null; anchor?: string | null; from?: string | null; to?: string | null; basis?: string | null }, defaults: { basis: Basis; fyStartMonth: number; today: string }): { kind: PeriodKind; range: Range; basis: Basis } | { error: string } {
  const basis: Basis = q.basis === "cash" || q.basis === "accrual" ? q.basis : defaults.basis;
  const kind = (["month", "quarter", "year", "custom"] as const).find((k) => k === q.kind) ?? "month";
  if (kind === "custom") {
    const range = customRange(q.from ?? "", q.to ?? "");
    return range ? { kind, range, basis } : { error: "Choose a start and an end date, the end on or after the start." };
  }
  const anchor = q.anchor && /^\d{4}-\d{2}(-\d{2})?$/.test(q.anchor) ? (q.anchor.length === 7 ? `${q.anchor}-01` : q.anchor) : defaults.today;
  const month = Number(anchor.slice(5, 7));
  if (month < 1 || month > 12) return { error: "That period isn't a real month." };
  return { kind, range: periodRange(kind, anchor, defaults.fyStartMonth), basis };
}
