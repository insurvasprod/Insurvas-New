/**
 * Partner payouts' tabs as plain rules (round 7, owner pick 9·A, 2026-11-10; docs/la4/mockups-r7/commissions.html):
 * an invoice's state is what you do next. To review (a draft that owes something), To pay (published, money owed),
 * Paid — with Nothing owed and Void as chips on Paid. A plain module, so the server page (counts, the invoice page's
 * ‹ ›) and the client list read one rule.
 */
export type InvoiceState = "review" | "pay" | "paid" | "nothing" | "void";
export type InvoiceTab = "review" | "pay" | "paid";
export type PayoutsTab = InvoiceTab | "ledger" | "rulebooks";

type Header = { status: string; netCents: number };
export const stateOf = (r: Header): InvoiceState => (r.status === "void" ? "void" : r.status === "paid" ? "paid" : r.netCents === 0 ? "nothing" : r.status === "draft" ? "review" : r.netCents > 0 ? "pay" : "nothing");
export const tabOf = (r: Header): InvoiceTab => { const s = stateOf(r); return s === "review" ? "review" : s === "pay" ? "pay" : "paid"; };

export const TAB_LABEL: Record<PayoutsTab, string> = { review: "To review", pay: "To pay", paid: "Paid", ledger: "Ledger", rulebooks: "Rulebooks" };

/** The old addresses: `?status=draft|published|paid|void|nothing|review|pay`, `?view=invoices|ledger|rulebooks`. */
export function tabFromParams(view: string | undefined, status: string | undefined): PayoutsTab | null {
  if (view === "ledger" || view === "rulebooks") return view;
  if (status === "draft" || status === "review") return "review";
  if (status === "published" || status === "pay") return "pay";
  if (status === "paid" || status === "void" || status === "nothing") return "paid";
  return null;
}

/** An invoice list in the list's order: newest pay period first. */
export const listOrder = <T extends { periodEnd: string; id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.id.localeCompare(b.id));
