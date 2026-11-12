import type { InvoiceStatus } from "./invoicesCore";

/**
 * Vendor bills' sub-page bar (round 7, owner 2026-11-10: docs/la4/mockups-r7/accounting.html 2·A). Where a bill
 * stands is the tab: To approve · Disputed · To pay · Paid · All, then Returns. A plain module, so the server
 * page (its counts, the bill page's ‹ › neighbours) and the client list read the same rule.
 *
 * The tab rides in `?status=`, so every old link still lands: `approve` (and `draft`, `received`, `open`) is To
 * approve, `approved` is To pay, `flagged` is All with the "Billed more than you got" chip on, `void` is All.
 */
export type BillTab = "approve" | "disputed" | "approved" | "paid" | "all";

export const BILL_TABS: { key: BillTab; label: string }[] = [
  { key: "approve", label: "To approve" },
  { key: "disputed", label: "Disputed" },
  { key: "approved", label: "To pay" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

/** The tab an old or new `?status=` names, and whether it switches the "Billed more than you got" chip on. */
export function billTabFor(status: string | null | undefined): { tab: BillTab; differs: boolean } {
  switch (status) {
    case "disputed": return { tab: "disputed", differs: false };
    case "approved": return { tab: "approved", differs: false };
    case "paid": return { tab: "paid", differs: false };
    case "all": case "void": return { tab: "all", differs: false };
    case "flagged": return { tab: "all", differs: true };
    default: return { tab: "approve", differs: false };
  }
}

/** A bill on a tab: To approve holds drafts and received bills; Disputed waits on the vendor, not on you. */
export function onBillTab(status: InvoiceStatus, tab: BillTab): boolean {
  if (tab === "all") return true;
  if (tab === "approve") return status === "draft" || status === "received";
  return status === tab;
}

/** A bill that differs from our count past the tolerance (a void bill never counts). */
export const billDiffers = (row: { flagged: boolean; status: InvoiceStatus }) => row.flagged && row.status !== "void";

/** What a bill needs next, in words: the step itself is taken on the bill's page (2·0, "nothing decided in a row"). */
export function billNextStep(row: { status: InvoiceStatus; flagged: boolean }): string | null {
  switch (row.status) {
    case "draft": return "Finish it, then save the bill";
    case "received": return row.flagged ? "Check the difference, then approve" : "Check it, then approve";
    case "disputed": return "Close the dispute when they answer";
    case "approved": return "Mark it paid";
    default: return null;
  }
}

const formatDay = (d: string, year: boolean) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
/** "Oct 4, 2026". */
export const billDate = (d: string) => formatDay(d, true);
/** "Sep 1 – Sep 30, 2026", or null when the bill names no period. */
export const billPeriod = (from: string | null, to: string | null) => (from ? `${formatDay(from, false)} – ${to ? formatDay(to, true) : "…"}` : null);
/** "September 2026", the month a cost entry is booked in. */
export const billMonth = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

/** Our figure for the bill: what it says, moved by the difference our count found; null before anything was counted. */
export const ourCents = (row: { subtotalCents: number; differenceCents: number | null }) => (row.differenceCents == null ? null : row.subtotalCents + row.differenceCents);

/** The Enter a bill title line's slot, which the client form fills with Discard · Save as draft · Save bill (2·3). */
export const BILL_FORM_ACTIONS = "bill-form-actions";

/** Where a vendor or partner is managed: the name on a bill links there. */
export const sourceHref = (type: "vendor" | "partner", id: string) => (type === "vendor" ? `/app/campaigns/vendors/${id}` : `/app/partner-quality/${id}`);

/** The bill page's address, carrying the list it was opened from so ‹ › walk that list. */
export const billHref = (id: string, from?: BillTab | null, tab?: "lines" | "count" | "ledger" | "document") => {
  const p = new URLSearchParams();
  if (tab) p.set("tab", tab);
  if (from) p.set("from", from);
  const q = p.toString();
  return `/app/vendor-bills/${id}${q ? `?${q}` : ""}`;
};
