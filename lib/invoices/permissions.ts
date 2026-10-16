import type { AdminRole } from "@/lib/adminAuth/roles";

// SA-3.3: "A support_agent cannot open invoice screens at all." Invoices are billing records, so
// this matches CAN_MANAGE_SUBSCRIPTIONS rather than the broader read access support agents have to
// tenants and users.
export const CAN_VIEW_INVOICES: readonly AdminRole[] = ["super_admin", "billing_admin"];

export function canViewInvoices(role: AdminRole): boolean {
  return CAN_VIEW_INVOICES.includes(role);
}

/** Voiding is the same permission — there is nobody who may read invoices but not void one. */
export const CAN_VOID_INVOICES = CAN_VIEW_INVOICES;

export function canVoidInvoices(role: AdminRole): boolean {
  return CAN_VOID_INVOICES.includes(role);
}

/**
 * A paid invoice cannot be voided.
 *
 * The money genuinely moved, so voiding it would leave our books disagreeing with the bank. The
 * correct instrument is a credit note or a refund (SA-3.8). Returning a reason rather than a
 * boolean so the UI can say why instead of hiding the button.
 */
export function voidRefusalReason(status: string, paidCents = 0): string | null {
  if (status === "paid") {
    return "This invoice was paid. Voiding it would leave the books disagreeing with the bank — issue a refund or a credit note instead.";
  }
  if (status === "void") return "This invoice is already void.";
  // Part-paid: money arrived against it, so voiding has the same problem as voiding a paid one —
  // the payment would point at an invoice that no longer asks for anything (billing audit,
  // 2026-10-15). The database trigger refuses it too.
  if (paidCents > 0) {
    return "Part of this invoice has been paid. Voiding it would leave that payment against nothing — refund or credit it instead.";
  }
  return null;
}
