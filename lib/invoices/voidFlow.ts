// Voiding an invoice, provider included (billing audit, 2026-10-15).
//
// The void route used to change our row only. An invoice pushed to Whop for collection kept its
// hosted pay page, so a customer could still pay an invoice we had written off — and that payment
// would then land on a void invoice. Now the provider invoice is voided FIRST, through the provider
// abstraction, and only then ours, with the pay link cleared. If the provider refuses (most likely
// because the customer just paid), nothing is voided here either.
//
// The local update is conditional on the status the refusal check read, so an invoice that was
// paid between the read and the write is not voided over the payment.
//
// Dependencies are injected so the whole flow is tested offline with a provider double; the route
// supplies the real Supabase reads/writes and the Whop provider. No value imports beyond the pure
// refusal rule.

import { voidRefusalReason } from "./permissions.ts";

export type VoidableInvoice = {
  id: string;
  number: string;
  status: string;
  tenant_id: string;
  total_cents: number;
  provider_invoice_id: string | null;
  pay_online_url: string | null;
};

export type VoidDeps = {
  /** Succeeded payments recorded against the invoice, in cents. */
  paidCents(invoiceId: string): Promise<number>;
  /** Voids the provider's copy. Absent when no provider is configured. */
  voidProviderInvoice?: (providerInvoiceId: string, tenantId: string) => Promise<void>;
  /** Writes the void when the status is still `expectedStatus`; returns the rows changed. */
  markVoid(input: { id: string; expectedStatus: string; reason: string; voidedAt: string }): Promise<number>;
};

export type VoidOutcome =
  | { ok: true; providerVoided: boolean }
  | { ok: false; status: 409 | 502 | 500; error: string };

export async function voidInvoiceWith(invoice: VoidableInvoice, reason: string, deps: VoidDeps): Promise<VoidOutcome> {
  const paid = await deps.paidCents(invoice.id);
  const refusal = voidRefusalReason(invoice.status, paid);
  if (refusal) return { ok: false, status: 409, error: refusal };

  let providerVoided = false;
  if (invoice.provider_invoice_id) {
    if (!deps.voidProviderInvoice) {
      return {
        ok: false,
        status: 502,
        error: "This invoice has a pay-online link at the payment provider, and the provider is not configured here, so it cannot be voided without leaving that link payable.",
      };
    }
    try {
      await deps.voidProviderInvoice(invoice.provider_invoice_id, invoice.tenant_id);
      providerVoided = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 502,
        error: `The payment provider did not void its copy of this invoice, so it was not voided here either (it may just have been paid): ${message}`,
      };
    }
  }

  const changed = await deps.markVoid({ id: invoice.id, expectedStatus: invoice.status, reason, voidedAt: new Date().toISOString() });
  if (changed !== 1) {
    return {
      ok: false,
      status: 409,
      error: providerVoided
        ? "The invoice changed while it was being voided (it may have been paid). The provider's pay link is already void — check the invoice before doing anything else."
        : "The invoice changed while it was being voided (it may have been paid). Nothing was voided.",
    };
  }
  return { ok: true, providerVoided };
}
