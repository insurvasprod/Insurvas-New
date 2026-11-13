/**
 * A producer's money as Commissions draws it (round 7, docs/la4/mockups-r7/commissions.html 4·1 and 5·A): the ledger
 * newest first, the chargebacks, and the months as statements (this month "Not paid yet" until the agency pays it).
 * Pure: the My pay page counts its tabs with it on the server and the Money tab draws with it in the browser.
 */
import type { Basis } from "@/lib/agency/statementCore";
import { ENTRY_LABELS } from "@/lib/agency/statementCore";
import type { PayPlan } from "@/lib/agency/payPlanCore";
import { monthLabel } from "@/lib/agency/payPlanCore";

export type Balance = { basis: Basis; balanceCents: number; earnedCents: number; chargebackCents: number; paidCents: number };
export type Entry = { id: string; entryType: string; basis: Basis; policyNumber: string | null; carrierId?: string | null; carrierName: string | null; clientName: string | null; amountCents: number; occurredOn: string; payoutRunId?: string | null; reason: string | null };
export type Run = { id: string; periodStart: string; periodEnd: string; status: string; netCents: number; withheldCents: number; paidOn: string | null; paidMethod?: string | null; paymentReference?: string | null };
export type MoneyData = { balances: Balance[]; entries: Entry[]; runs: Run[]; plan?: PayPlan | null };
export type MoneyView = "statements" | "ledger" | "chargebacks";

const EARN = new Set(["earned", "advance_paid", "split_earned", "split_advance", "salary", "app_bonus", "save_fee"]);
const CHARGEBACK = new Set(["chargeback", "split_chargeback"]);
const PAID = new Set(["payout", "split_paid"]);
export const isEarned = (e: Entry) => EARN.has(e.entryType);
export const isChargeback = (e: Entry) => CHARGEBACK.has(e.entryType);
export const isPaid = (e: Entry) => PAID.has(e.entryType);

/** "all", a month ("2026-10") or a year ("2026") → the dates it covers. */
export function rangeOf(selection: string): { from: string; to: string } | null {
  if (/^\d{4}-\d{2}$/.test(selection)) {
    const [y, m] = selection.split("-").map(Number);
    return { from: `${selection}-01`, to: `${selection}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
  }
  if (/^\d{4}$/.test(selection)) return { from: `${selection}-01-01`, to: `${selection}-12-31` };
  return null;
}
const within = (day: string, range: { from: string; to: string } | null) => !range || (day >= range.from && day <= range.to);

export type StatementRow = {
  key: string;
  runId: string | null;
  /** YYYY-MM */
  month: string;
  status: "paid" | "published" | "not_paid";
  paidOn: string | null;
  earnedCents: number;
  takenBackCents: number;
  paidCents: number | null;
  withheldCents: number;
  how: string;
};

/** Who the money went to, in the reader's words: "Paid to you" for the producer, "Paid to Marcus" for the owner. */
export function entryLabel(type: string, paidTo: string | null): string {
  if (PAID.has(type)) return paidTo ? `Paid to ${paidTo}` : "Paid to you";
  return ENTRY_LABELS[type] ?? type.replaceAll("_", " ");
}

/** The three lists for a month, a year or every month: the ledger and the chargebacks newest first, the months newest first. */
export function moneyLists(data: MoneyData, selection: string, today = new Date().toISOString().slice(0, 10)) {
  const range = rangeOf(selection);
  const newest = (a: Entry, b: Entry) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id);
  const ledger = data.entries.filter((e) => within(e.occurredOn, range)).sort(newest);
  const chargebacks = ledger.filter(isChargeback);
  const monthOf = (from: string, to: string) => {
    const lines = data.entries.filter((e) => e.occurredOn >= from && e.occurredOn <= to);
    return {
      earnedCents: lines.filter(isEarned).reduce((s, e) => s + e.amountCents, 0),
      takenBackCents: lines.filter(isChargeback).reduce((s, e) => s + e.amountCents, 0),
    };
  };
  const statements: StatementRow[] = data.runs
    .filter((r) => within(r.periodStart, range))
    .map((r) => ({
      key: r.id,
      runId: r.id,
      month: r.periodStart.slice(0, 7),
      status: r.status === "paid" ? "paid" as const : "published" as const,
      paidOn: r.paidOn,
      ...monthOf(r.periodStart, r.periodEnd),
      paidCents: r.netCents,
      withheldCents: r.withheldCents,
      how: r.status === "paid" ? [r.paidMethod ?? "Paid", r.paymentReference ? `ref ${r.paymentReference}` : null].filter(Boolean).join(" · ") : "Published, not marked paid yet",
    }));
  // This month, until the agency pays it: what is earned so far.
  const thisMonth = today.slice(0, 7);
  if (within(`${thisMonth}-01`, range) && !statements.some((s) => s.month === thisMonth)) {
    const own = rangeOf(thisMonth)!;
    const [y, m] = thisMonth.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    statements.push({ key: `now-${thisMonth}`, runId: null, month: thisMonth, status: "not_paid", paidOn: null, ...monthOf(own.from, own.to), paidCents: null, withheldCents: 0, how: `the agency pays in early ${next}` });
  }
  statements.sort((a, b) => b.month.localeCompare(a.month));
  return { ledger, chargebacks, statements };
}

/** The strip's figures for the same selection. */
export function moneyFigures(data: MoneyData, selection: string) {
  const range = rangeOf(selection);
  const lines = data.entries.filter((e) => within(e.occurredOn, range));
  const earned = lines.filter(isEarned);
  const charged = lines.filter(isChargeback);
  const paidRuns = data.runs.filter((r) => r.status === "paid" && within(r.paidOn ?? r.periodEnd, range));
  return {
    owed: data.balances.find((b) => b.basis === "reported") ?? null,
    earnedCents: earned.reduce((s, e) => s + e.amountCents, 0),
    policies: new Set(earned.map((e) => e.policyNumber).filter(Boolean)).size,
    chargedBackCents: charged.reduce((s, e) => s + e.amountCents, 0),
    chargebacks: charged.length,
    paidCents: paidRuns.reduce((s, r) => s + r.netCents, 0),
    statements: paidRuns.length,
  };
}

export { monthLabel };
