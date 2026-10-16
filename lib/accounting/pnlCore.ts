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

export function customRange(from: string, toInclusive: string): Range | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(toInclusive) || toInclusive < from) return null;
  const to = new Date(Date.parse(`${toInclusive}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from, to, label: `${from} to ${toInclusive}` };
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
