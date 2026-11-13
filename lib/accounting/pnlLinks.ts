import { COST_ENTRY_LABELS, type Basis, type CostEntryType } from "./costLedgerCore";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "./expensesCore";
import { IN_LABELS, type PeriodKind, type PnlLine, type Range } from "./pnlCore";

/**
 * Profit & loss addresses (foundation pass 2026-11-03): the step's two tabs on the title line and each line's
 * entries page. A plain module, so the server page and the client board build the same links.
 */
export type PnlTab = "statement" | "trend" | "cohorts";
export type PnlQuery = { kind: PeriodKind; anchor: string; from: string; to: string; basis: Basis };

function periodParams(q: PnlQuery) {
  const p = new URLSearchParams({ kind: q.kind, basis: q.basis });
  if (q.kind === "custom") { p.set("from", q.from); p.set("to", q.to); } else p.set("anchor", q.anchor);
  return p;
}

/** This period and basis on a tab of the step. */
export function pnlHref(q: PnlQuery, view: PnlTab = "statement") {
  const p = periodParams(q);
  if (view !== "statement") p.set("view", view);
  return `/app/pnl?${p}`;
}

export function pnlTabs(q: PnlQuery) {
  return [
    { key: "statement" as const, label: "Statement", href: pnlHref(q, "statement") },
    { key: "trend" as const, label: "Last six months", href: pnlHref(q, "trend") },
    // LA-7.7: the months old enough to have a cost per persisting policy (the trailing view).
    { key: "cohorts" as const, label: "Persisting cost", href: pnlHref(q, "cohorts") },
  ];
}

/** A line's name, as the statement lists it. */
export function lineLabel(l: Pick<PnlLine, "section" | "entryType" | "sourceType" | "sourceName">): string {
  if (l.section === "in" || l.section === "held") return IN_LABELS[l.entryType] ?? l.entryType;
  if (l.sourceType === "expense_category" && l.sourceName) return EXPENSE_CATEGORY_LABELS[l.sourceName as ExpenseCategory] ?? l.sourceName;
  const kind = l.entryType === "lead_cost" ? "Lead costs" : l.entryType === "partner_payout" ? "Partner payouts" : l.entryType === "refund" ? "Refunds" : l.entryType === "tool_subscription" || l.entryType === "platform_fee" ? "Platform & tools" : COST_ENTRY_LABELS[l.entryType as CostEntryType] ?? l.entryType;
  return l.sourceName ? `${kind} — ${l.sourceName}` : l.entryType === "lead_cost" ? "Lead costs — no source" : kind;
}

/**
 * One line's entries, for this period and basis (/app/pnl/entries). Only the line's identity travels; the page
 * names the line from the statement itself (round 7: the title is never taken from the address).
 */
export function entriesHref(l: Pick<PnlLine, "section" | "entryType" | "sourceType" | "sourceId" | "sourceName">, q: PnlQuery) {
  const p = periodParams(q);
  p.set("section", l.section);
  p.set("entry_type", l.entryType);
  if (l.sourceType) p.set("source_type", l.sourceType);
  if (l.sourceId) p.set("source_id", l.sourceId);
  if (l.sourceType === "expense_category" && l.sourceName) p.set("category", l.sourceName);
  return `/app/pnl/entries?${p}`;
}

/** The address of another period (the one before, last year) as the screen asks for it: a custom range ends the day before `to`. */
export function queryFor(kind: PeriodKind, basis: Basis, r: Range): PnlQuery {
  if (kind !== "custom") return { kind, anchor: r.from.slice(0, 7), from: "", to: "", basis };
  const last = new Date(Date.parse(`${r.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { kind, anchor: r.from.slice(0, 7), from: r.from, to: last, basis };
}

/** A month of the six-month view, opened on the Statement. */
export function monthHref(ym: string, basis: Basis) {
  return pnlHref({ kind: "month", anchor: ym, from: "", to: "", basis });
}

/** Bank deposits › Accounts: where a bank file is added, for "Not imported". */
export const BANK_ACCOUNTS_HREF = "/app/bank?view=accounts";
