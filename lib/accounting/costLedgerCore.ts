/**
 * LA-7.1 (Notion sprint, Module 7 — Accounting) · the cost ledger's rules, with no database: the
 * nine kinds of money out, the sign each one carries, and the two bases a period can be read on.
 *
 * Money is integer cents, signed: money out is negative, so net is a plain sum with no branch to
 * get wrong. Nothing here ever holds a float — amounts are parsed from strings (parseDollarsToCents)
 * and summed in the database as bigint.
 */

export const COST_ENTRY_TYPES = ["lead_cost", "partner_payout", "producer_split", "platform_fee", "tool_subscription", "insurance", "professional_fee", "refund", "adjustment"] as const;
export type CostEntryType = (typeof COST_ENTRY_TYPES)[number];

export const COST_ENTRY_LABELS: Record<CostEntryType, string> = {
  lead_cost: "Lead cost",
  partner_payout: "Partner payout",
  producer_split: "Producer split",
  platform_fee: "Platform fee",
  tool_subscription: "Tools & subscriptions",
  insurance: "Insurance",
  professional_fee: "Professional fees",
  refund: "Refund",
  adjustment: "Adjustment",
};

export const COUNTERPARTY_TYPES = ["vendor", "partner", "producer", "platform", "other"] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

export const BASES = ["accrual", "cash"] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABELS: Record<Basis, string> = {
  accrual: "Accrual — by the period each cost belongs to",
  cash: "Cash — by the day money moved",
};

/** The sign a new entry must carry. Mirrors the cost_entry_sign constraint (20261015200000). */
export function signProblem(type: CostEntryType, amountCents: number): string | null {
  if (!Number.isSafeInteger(amountCents)) return "The amount must be a whole number of cents.";
  if (type === "refund") return amountCents > 0 ? null : "A refund is money back: enter it as a positive amount.";
  if (type === "adjustment") return amountCents !== 0 ? null : "An adjustment cannot be zero.";
  return amountCents < 0 ? null : "Money out is recorded as a negative amount.";
}

/** Money out is stored negative whatever the person typed; refunds stay positive; adjustments as typed. */
export function signedForType(type: CostEntryType, typedCents: number): number {
  if (type === "adjustment") return typedCents;
  const magnitude = Math.abs(typedCents);
  return type === "refund" ? magnitude : -magnitude;
}

export type Period = { from: string; to: string };

/** A calendar month as a half-open range of ISO dates: "2026-08" → 2026-08-01 … 2026-09-01. */
export function monthPeriod(month: string): Period | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return { from: `${m[1]}-${m[2]}-01`, to: `${next}-01` };
}

export type NetRow = { side: "commission" | "cost"; entryType: string; amountCents: number; entries: number };

/** The figures a period's rows add up to. Integer addition only. */
export function totals(rows: NetRow[]) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of rows) {
    if (r.side === "commission") moneyIn += r.amountCents;
    else moneyOut += r.amountCents;
  }
  return { moneyInCents: moneyIn, moneyOutCents: moneyOut, netCents: moneyIn + moneyOut };
}
