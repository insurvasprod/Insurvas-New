// Recognising a payment for one of OUR pay-online invoices (billing audit, 2026-10-15).
//
// A custom or period invoice is pushed to Whop as a one-off plan (lib/billing/collect.ts). Whop's
// create-invoice call accepts no plan metadata, so the payment.succeeded that follows used to carry
// nothing we recognised: createInvoiceFromPayment answered plan_not_ours, the webhook threw, Whop
// retried for days, and the invoice the customer had paid stayed unpaid — a suspended tenant stayed
// suspended. `provider_invoice_id` was written and never read.
//
// What does come back: the plan's `internal_notes` (Whop echoes them on the payment's `plan`), so the
// local invoice id is written there as a marker. A payment that carries Whop's own invoice id is
// matched on provider_invoice_id as well.
//
// Pure and client-safe: no imports, so plain Node tests and the billing script load it directly.

/** Written into the Whop plan's internal_notes when an invoice is sent for collection. */
export const INVOICE_MARKER_PREFIX = "insurvas_invoice_id:";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function invoiceMarker(localInvoiceId: string): string {
  return `${INVOICE_MARKER_PREFIX}${localInvoiceId}`;
}

export type ProviderInvoiceRef = {
  /** Our platform_invoices.id, from the marker or the plan metadata. */
  localInvoiceId: string | null;
  /** Whop's invoice id (`inv_…`), when the payment names one. */
  providerInvoiceId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The local invoice id in a free-text note, when it carries our marker. */
export function localInvoiceIdFromNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const at = note.indexOf(INVOICE_MARKER_PREFIX);
  if (at < 0) return null;
  const match = UUID.exec(note.slice(at + INVOICE_MARKER_PREFIX.length));
  return match && match.index === 0 ? match[0].toLowerCase() : null;
}

/**
 * Which of our invoices a payment.succeeded is for, if any. Null when the payment carries no
 * reference to an invoice at all — the caller then treats it as a subscription payment.
 */
export function providerInvoiceRef(data: Record<string, unknown> | undefined | null): ProviderInvoiceRef | null {
  if (!data) return null;
  const plan = asRecord(data.plan);
  const metadata = asRecord(plan?.metadata);

  const fromMetadata = typeof metadata?.insurvas_invoice_id === "string" && UUID.test(metadata.insurvas_invoice_id)
    ? (UUID.exec(metadata.insurvas_invoice_id)?.[0] ?? null)
    : null;
  const localInvoiceId = localInvoiceIdFromNote(plan?.internal_notes) ?? fromMetadata?.toLowerCase() ?? null;

  const invoice = asRecord(data.invoice);
  const rawProviderId = typeof invoice?.id === "string" ? invoice.id : typeof data.invoice_id === "string" ? data.invoice_id : null;
  const providerInvoiceId = rawProviderId && /^inv_[A-Za-z0-9]+$/.test(rawProviderId) ? rawProviderId : null;

  if (!localInvoiceId && !providerInvoiceId) return null;
  return { localInvoiceId, providerInvoiceId };
}
