// Admin › Billing › Refunds & credits (billing-r2 screen 6): the lenses, the search and the status line, read
// from the address and the notes the page holds. Plain module: the page, the table and node:test use it.

/** Money that failed is danger; money still waiting on a human is warning. */
export const CREDIT_NOTE_TONE: Record<string, "warning" | "info" | "neutral" | "good" | "danger"> = {
  pending_approval: "warning",
  approved: "info",
  processing: "neutral",
  succeeded: "good",
  failed: "danger",
  rejected: "neutral",
};
export const CREDIT_NOTE_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  processing: "Processing",
  succeeded: "Succeeded",
  failed: "Failed at provider",
  rejected: "Rejected",
};
/** The local ledger's side of a refund, after the provider has answered. */
export const CREDIT_NOTE_RECONCILIATION: Record<string, string> = {
  pending: "Not started",
  provider_pending: "Awaiting reconciliation",
  reconciled: "Reconciled",
  failed: "Reconciliation failed",
};

export type CreditNoteLike = {
  id: string;
  number: string;
  status: string;
  amount_cents: number;
  reason_text: string | null;
  requested_by: string | null;
  created_at: string;
  reconciliation_state?: string;
  tenants: { name: string } | null;
  invoice: { id: string; number: string } | null;
};

export const CREDIT_NOTE_LENSES = ["all", "approval", "failed", "reconciliation"] as const;
export type CreditNoteLens = (typeof CREDIT_NOTE_LENSES)[number];
export const CREDIT_NOTE_LENS_LABELS: Record<CreditNoteLens, string> = {
  all: "All",
  approval: "Needs approval",
  failed: "Failed",
  reconciliation: "Awaiting reconciliation",
};

const ALIASES: Record<string, CreditNoteLens> = {
  all: "all",
  approval: "approval",
  pending: "approval",
  pending_approval: "approval",
  "needs-approval": "approval",
  failed: "failed",
  reconciliation: "reconciliation",
  provider_pending: "reconciliation",
  "awaiting-reconciliation": "reconciliation",
};

export function parseCreditNoteLens(raw: string | null | undefined): CreditNoteLens {
  return ALIASES[(raw ?? "").trim().toLowerCase()] ?? "all";
}

export function inCreditNoteLens(note: CreditNoteLike, lens: CreditNoteLens): boolean {
  switch (lens) {
    case "approval": return note.status === "pending_approval";
    case "failed": return note.status === "failed";
    case "reconciliation": return note.reconciliation_state === "provider_pending";
    default: return true;
  }
}

/** Search over the credit note's number, the customer, the invoice it is against and its reason. */
export function matchesCreditNoteSearch(note: CreditNoteLike, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [note.number, note.tenants?.name, note.invoice?.number, note.reason_text].some((value) => (value ?? "").toLowerCase().includes(needle));
}

export function lensCounts(notes: CreditNoteLike[]): Record<CreditNoteLens, number> {
  return Object.fromEntries(CREDIT_NOTE_LENSES.map((lens) => [lens, notes.filter((note) => inCreditNoteLens(note, lens)).length])) as Record<CreditNoteLens, number>;
}

