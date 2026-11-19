import "server-only";

import { isSubscribedEvent, type WhopEnvelope } from "./events";
import { markFailed, markProcessed } from "./store";
import { createInvoiceFromPayment, isBenignNoInvoice } from "@/lib/invoices/generate";
import { applyProviderEvent } from "@/lib/subscriptions/applyProviderEvent";
import {
  recordUnmatchedPayment,
  settleInvoiceFromProviderPayment,
  settleUnmarkedInvoiceByAmount,
  type ProviderSettlement,
} from "@/lib/invoices/settleFromProvider";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

/**
 * `stage` says which kind of failure, so the webhook answers exactly as it always has: "record" when an ignored event
 * could not be marked handled (500 "Could not record event"), "handler" when processing failed (500 "Handler failed").
 * Either way Whop retries, and the store treats an unprocessed repeat as work still to do.
 */
export type WhopProcessOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; stage: "record" | "handler" };

/**
 * What the Whop webhook does with a stored, verified event — the body of app/api/webhooks/whop/route.ts after its
 * signature check and its store step, line for line, so a replay from Admin › Billing › Payment provider (admin round
 * 1, billing-r2 screen 12) runs exactly today's processor on the stored event.
 *
 * The webhook route (app/api/webhooks/whop/route.ts) calls this after its signature check and store step, and Replay
 * calls it on a stuck event, so the two can never drift (admin round 1, 2026-11-17).
 *
 * Marks the event processed on success and failed (with the reason) on error, as the route does. Every step it calls
 * is idempotent on the provider's ids, which is what makes running it again on a stuck event safe.
 */
export async function processWhopEvent(stored: { id: string; tenantId: string | null }, envelope: WhopEnvelope): Promise<WhopProcessOutcome> {
  if (!isSubscribedEvent(envelope.type)) {
    // Signed, stored, and not something we act on. Mark it handled so retries stop.
    try {
      await markProcessed(stored.id);
    } catch (error) {
      // Stored but not marked: ask for the retry rather than acknowledging a row that still reads as unprocessed
      // work. The retry is harmless — there is nothing to do but mark it.
      console.error(`[whop-webhook] could not mark ignored ${envelope.type} ${stored.id} processed:`, error);
      return { ok: false, error: error instanceof Error ? error.message : String(error), stage: "record" };
    }
    return { ok: true, result: { ignored: envelope.type } };
  }

  try {
    if (envelope.type === "payment.succeeded") {
      // One of OUR pay-online invoices (custom or period), named by the marker collect.ts writes onto the Whop plan,
      // or by Whop's invoice id. It settles that invoice — never a new one — and the access consequence is the
      // invoice's own (the subscription it belongs to).
      const invoicePayment = await settleInvoiceFromProviderPayment(envelope, stored.tenantId);
      if (invoicePayment.matched) {
        await finishInvoiceSettlement(invoicePayment.settlement, envelope);
        await markProcessed(stored.id);
        return { ok: true, result: { type: envelope.type, tenantId: invoicePayment.settlement.tenantId, invoice: invoicePayment.settlement.invoiceNumber } };
      }
      if (invoicePayment.referenced) {
        // Names an invoice we do not hold — another environment sharing the Whop account, say. Not ours: acknowledge,
        // keep the event, change nobody's books or access.
        console.error(`[whop-webhook] payment ${String(envelope.data?.id ?? "?")} names an invoice that is not ours; acknowledged without effect`);
        if (stored.tenantId) await recordUnmatchedPayment(envelope, stored.tenantId);
        await markProcessed(stored.id);
        return { ok: true, result: { ignored: "invoice_not_ours" } };
      }

      // SA-3.2. Idempotent on the provider payment id, so a redelivery cannot bill twice.
      const outcome = await createInvoiceFromPayment(envelope, stored.tenantId);

      if (outcome.ok) {
        if (outcome.invoice.created) console.log(`[whop-webhook] invoice ${outcome.invoice.number} created (${outcome.invoice.reconciliation})`);
      } else if (outcome.reason === "plan_not_ours" && stored.tenantId) {
        // No plan metadata of ours. Either a pay-online invoice sent before the marker existed — settled when exactly
        // one open invoice of this tenant matches the amount — or a payment for something we do not sell. The second
        // is acknowledged and recorded, not retried for three days: nothing we can do will make it ours.
        const legacy = await settleUnmarkedInvoiceByAmount(envelope, stored.tenantId);
        if (legacy) {
          await finishInvoiceSettlement(legacy, envelope);
        } else {
          console.warn(`[whop-webhook] payment for tenant ${stored.tenantId} matches nothing we bill (${outcome.detail}); recorded without an invoice`);
          await recordUnmatchedPayment(envelope, stored.tenantId);
        }
        await markProcessed(stored.id);
        return { ok: true, result: { type: envelope.type, tenantId: stored.tenantId, invoice: legacy?.invoiceNumber ?? null } };
      } else if (isBenignNoInvoice(outcome.reason)) {
        // No tenant could be resolved — the shape of Whop's own dashboard test event, which carries placeholder ids
        // and no metadata. Nothing was collected from anyone, so acknowledging it is correct.
        console.log(`[whop-webhook] payment not attributable to a tenant (${outcome.detail}); ignoring`);
      } else {
        // bugs_sa.md M3-2. We KNOW which tenant paid and could not write down what for. Acknowledging with a 200 once
        // meant the money never appeared in the ledger. Throwing leaves processed_at null, records the reason on the
        // event, and asks Whop to retry — so it is visible and recoverable instead of silently lost.
        throw new Error(`payment.succeeded for tenant ${stored.tenantId} produced no invoice (${outcome.reason}: ${outcome.detail})`);
      }
    }

    // SA-3.4. The invoice records what was billed; this decides what the tenant may now do. Ordering-guarded inside,
    // because Whop does not deliver events in order.
    const outcome = await applyProviderEvent(envelope, stored.tenantId);
    if (outcome.applied) console.log(`[whop-webhook] tenant ${stored.tenantId}: ${outcome.previousStatus} -> ${outcome.newStatus} (${envelope.type})`);

    await markProcessed(stored.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markFailed(stored.id, message);
    } catch (failureUpdateError) {
      // Do not turn a state-write failure into a false acknowledgement. The original handler error remains the
      // reason; the secondary error is retained in server logs.
      console.error(`[whop-webhook] could not persist failure for ${stored.id}:`, failureUpdateError);
    }
    console.error(`[whop-webhook] handling ${envelope.type} failed:`, error);
    return { ok: false, error: message, stage: "handler" };
  }

  return { ok: true, result: { type: envelope.type, tenantId: stored.tenantId } };
}

/**
 * After an invoice settled from a provider payment: the entitlement cache follows a reactivated subscription, and
 * money that moved somewhere it should not have is said out loud.
 */
async function finishInvoiceSettlement(settlement: ProviderSettlement, envelope: { data?: Record<string, unknown> }) {
  console.log(
    `[whop-webhook] invoice ${settlement.invoiceNumber} ${settlement.settled ? "settled" : `now ${settlement.status}`} by payment ${String(envelope.data?.id ?? "?")} (${settlement.paidCents} cents received)`,
  );
  if (settlement.anomaly) {
    console.error(`[whop-webhook] invoice ${settlement.invoiceNumber} for tenant ${settlement.tenantId}: ${settlement.anomaly} — needs a refund or a credit`);
  }
  // Outside the settlement transaction on purpose, as in the manual mark-paid route: the entitlement is a cache, and
  // failing the money because the cache could not be rebuilt would be worse. rebuildEntitlement logs loudly on its own.
  if (settlement.subscriptionActivated) await rebuildEntitlement(settlement.tenantId, "subscription.plan_changed");
}
