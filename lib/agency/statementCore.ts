/**
 * AG-1.8 (Notion sprint, Agency Module 0 / AG-1) · the producer statement, with no database (client-safe).
 *
 * The document that prevents arguments: line by line, what he earned and what was taken back. It is generated
 * from the ledger at render time — only the run id and period are stored — so its totals are always
 * SUM(amount_cents) over the same entries and it reconciles to the ledger by construction. Every line carries its
 * basis, so an expected figure is never mistaken for money that arrived. Client name and policy number only.
 */

export type Basis = "expected" | "reported" | "received";

export const BASIS_LABELS: Record<Basis, string> = { expected: "Expected", reported: "Reported", received: "Received" };

export const ENTRY_LABELS: Record<string, string> = {
  earned: "Earned",
  advance_paid: "Advance paid",
  chargeback: "Chargeback",
  adjustment: "Adjustment",
  payout: "Paid to you",
  split_advance: "Share of an advance",
  split_earned: "Share of earned commission",
  split_chargeback: "Share of a chargeback",
  split_paid: "Paid to you",
};

export const isMovement = (type: string) => ["earned", "chargeback", "split_advance", "split_earned", "split_chargeback"].includes(type);
export const isPayout = (type: string) => ["payout", "split_paid", "advance_paid"].includes(type);

export type StatementEntry = {
  id: string;
  entryType: string;
  basis: Basis;
  policyNumber: string | null;
  carrierName: string | null;
  clientName: string | null;
  premiumCents: number | null;
  premiumMode: string | null;
  levelBps: number | null;
  amountCents: number;
  occurredOn: string;
  reason: string | null;
};

export type StatementLine = {
  id: string;
  client: string;
  carrier: string;
  policy: string;
  premiumCents: number | null;
  premiumMode: string | null;
  levelBps: number | null;
  grossCents: number | null;
  chargebackCents: number | null;
  netCents: number;
  basis: Basis;
  label: string;
};

export type Statement = {
  openingCents: number;
  lines: StatementLine[];
  adjustments: Array<{ id: string; amountCents: number; reason: string; basis: Basis }>;
  payouts: Array<{ id: string; amountCents: number; basis: Basis }>;
  movementCents: number;
  closingCents: number;
};

/**
 * Builds a statement for one period from the ledger. `before` are the entries dated before the period (the opening
 * balance); `during` are the period's. Only one basis per statement — the payout basis, reported.
 */
export function buildStatement(before: readonly StatementEntry[], during: readonly StatementEntry[], basis: Basis = "reported"): Statement {
  const keep = (e: StatementEntry) => e.basis === basis;
  const openingCents = before.filter(keep).reduce((sum, e) => sum + e.amountCents, 0);
  const rows = during.filter(keep);
  const lines: StatementLine[] = rows.filter((e) => isMovement(e.entryType)).map((e) => {
    const isBack = e.amountCents < 0;
    return {
      id: e.id,
      client: e.clientName ?? "—",
      carrier: e.carrierName ?? "—",
      policy: e.policyNumber ?? "—",
      premiumCents: e.premiumCents,
      premiumMode: e.premiumMode,
      levelBps: e.levelBps,
      grossCents: isBack ? null : e.amountCents,
      chargebackCents: isBack ? e.amountCents : null,
      netCents: e.amountCents,
      basis: e.basis,
      label: ENTRY_LABELS[e.entryType] ?? e.entryType,
    };
  });
  const adjustments = rows.filter((e) => e.entryType === "adjustment").map((e) => ({ id: e.id, amountCents: e.amountCents, reason: e.reason ?? "", basis: e.basis }));
  const payouts = rows.filter((e) => isPayout(e.entryType)).map((e) => ({ id: e.id, amountCents: e.amountCents, basis: e.basis }));
  const movementCents = rows.reduce((sum, e) => sum + e.amountCents, 0);
  return { openingCents, lines, adjustments, payouts, movementCents, closingCents: openingCents + movementCents };
}

/** A premium as shown on a statement line: "$100/mo". Integer cents, no float. */
export function premiumLabel(cents: number | null, mode: string | null): string {
  if (cents === null) return "—";
  const dollars = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  const per = mode === "monthly" || mode === "month" || mode === "M" ? "/mo" : mode === "annual" || mode === "A" ? "/yr" : mode ? `/${mode}` : "";
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}${per}`;
}
