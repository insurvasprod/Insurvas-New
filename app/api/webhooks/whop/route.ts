import { NextResponse, type NextRequest } from "next/server";

import { verifyWhopSignature } from "@/lib/payments/whop/verify";
import { isSubscribedEvent, parseEnvelope } from "@/lib/payments/whop/events";
import { markFailed, markProcessed, recordWebhookEvent } from "@/lib/payments/whop/store";
import { createInvoiceFromPayment, isBenignNoInvoice } from "@/lib/invoices/generate";
import { applyProviderEvent } from "@/lib/subscriptions/applyProviderEvent";
import {
  recordUnmatchedPayment,
  settleInvoiceFromProviderPayment,
  settleUnmarkedInvoiceByAmount,
  type ProviderSettlement,
} from "@/lib/invoices/settleFromProvider";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

// This route must read the raw body to verify the signature, so it cannot be statically analysed
// or cached.
export const dynamic = "force-dynamic";

/**
 * SA-3.1 · Whop webhook receiver.
 *
 * This endpoint is unauthenticated by necessity — Whop calls it, not a logged-in user — which
 * makes the signature check the ONLY thing standing between the public internet and an API that
 * marks invoices paid. Nothing is read out of the payload before the signature verifies.
 *
 * Whop expects a 2xx within 5 seconds and retries anything else for ~3 days.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    // A 500 is right: this is our misconfiguration, and Whop's retries give us time to fix it
    // before the event is lost.
    console.error("[whop-webhook] WHOP_WEBHOOK_SECRET is not set — cannot verify anything");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Raw text, not request.json(). Parsing and re-serialising changes the bytes that were signed.
  const raw = await request.text();
  const headers = Object.fromEntries(request.headers);

  const verified = verifyWhopSignature({ payload: raw, headers, secret });
  if (!verified.ok) {
    console.warn(`[whop-webhook] rejected: ${verified.reason}`);
    // 401 rather than 400: this is an authentication failure. Whop will retry, and a genuinely
    // unsigned request will keep failing, which is the correct outcome.
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const envelope = parseEnvelope(raw);
  if (!envelope) {
    // Signed by Whop but not something we can read. Retrying will not change that, so accept it
    // and stop the retries rather than leaving a 3-day loop running.
    console.error("[whop-webhook] signed payload could not be parsed as an event envelope");
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  let stored;
  try {
    stored = await recordWebhookEvent(verified.webhookId, envelope);
  } catch (error) {
    console.error("[whop-webhook] could not record event:", error);
    // Storing failed, so nothing was persisted. Ask for the retry.
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  if (stored.alreadyProcessed) {
    // A genuine duplicate delivery. Whop delivers at least once, so this is expected traffic.
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (stored.inFlight) {
    // The same webhook-id is being handled right now by a concurrent delivery. Running it twice in
    // parallel is what produced the unique-violation 500 (billing audit, 2026-10-15). The first
    // delivery owns the outcome: if it fails, its own 500 brings Whop back with this id.
    return NextResponse.json({ ok: true, duplicate: true, inFlight: true });
  }

  if (!isSubscribedEvent(envelope.type)) {
    // Signed, stored, and not something we act on. Mark it handled so retries stop.
    try {
      await markProcessed(stored.id);
    } catch (error) {
      // Stored but not marked: ask for the retry rather than acknowledging a row that still reads
      // as unprocessed work. The retry is harmless — there is nothing to do but mark it.
      console.error(`[whop-webhook] could not mark ignored ${envelope.type} ${stored.id} processed:`, error);
      return NextResponse.json({ error: "Could not record event" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, ignored: envelope.type });
  }

  try {
    if (envelope.type === "payment.succeeded") {
      // One of OUR pay-online invoices (custom or period), named by the marker collect.ts writes
      // onto the Whop plan, or by Whop's invoice id. It settles that invoice — never a new one —
      // and the access consequence is the invoice's own (the subscription it belongs to).
      const invoicePayment = await settleInvoiceFromProviderPayment(envelope, stored.tenantId);
      if (invoicePayment.matched) {
        await finishInvoiceSettlement(invoicePayment.settlement, envelope);
        await markProcessed(stored.id);
        return NextResponse.json({ ok: true, type: envelope.type, tenantId: invoicePayment.settlement.tenantId, invoice: invoicePayment.settlement.invoiceNumber });
      }
      if (invoicePayment.referenced) {
        // Names an invoice we do not hold — another environment sharing the Whop account, say.
        // Not ours: acknowledge, keep the event, change nobody's books or access.
        console.error(`[whop-webhook] payment ${String(envelope.data?.id ?? "?")} names an invoice that is not ours; acknowledged without effect`);
        if (stored.tenantId) await recordUnmatchedPayment(envelope, stored.tenantId);
        await markProcessed(stored.id);
        return NextResponse.json({ ok: true, ignored: "invoice_not_ours" });
      }

      // SA-3.2. Idempotent on the provider payment id, so a redelivery cannot bill twice.
      const outcome = await createInvoiceFromPayment(envelope, stored.tenantId);

      if (outcome.ok) {
        if (outcome.invoice.created) {
          console.log(`[whop-webhook] invoice ${outcome.invoice.number} created (${outcome.invoice.reconciliation})`);
        }
      } else if (outcome.reason === "plan_not_ours" && stored.tenantId) {
        // No plan metadata of ours. Either a pay-online invoice sent before the marker existed —
        // settled when exactly one open invoice of this tenant matches the amount — or a payment
        // for something we do not sell. The second is acknowledged and recorded, not retried for
        // three days: nothing we can do will make it ours.
        const legacy = await settleUnmarkedInvoiceByAmount(envelope, stored.tenantId);
        if (legacy) {
          await finishInvoiceSettlement(legacy, envelope);
        } else {
          console.warn(`[whop-webhook] payment for tenant ${stored.tenantId} matches nothing we bill (${outcome.detail}); recorded without an invoice`);
          await recordUnmatchedPayment(envelope, stored.tenantId);
        }
        await markProcessed(stored.id);
        return NextResponse.json({ ok: true, type: envelope.type, tenantId: stored.tenantId, invoice: legacy?.invoiceNumber ?? null });
      } else if (isBenignNoInvoice(outcome.reason)) {
        // No tenant could be resolved — the shape of Whop's own dashboard test event, which
        // carries placeholder ids and no metadata. Nothing was collected from anyone, so
        // acknowledging it is correct.
        console.log(`[whop-webhook] payment not attributable to a tenant (${outcome.detail}); ignoring`);
      } else {
        // bugs_sa.md M3-2. We KNOW which tenant paid and could not write down what for. Previously
        // this was acknowledged with a 200 and the money simply never appeared in the ledger.
        // Throwing leaves processed_at null, records the reason on the event, and asks Whop to
        // retry — so it is visible and recoverable instead of silently lost.
        throw new Error(
          `payment.succeeded for tenant ${stored.tenantId} produced no invoice (${outcome.reason}: ${outcome.detail})`,
        );
      }
    }

    // SA-3.4. The invoice records what was billed; this decides what the tenant may now do.
    // Ordering-guarded inside, because Whop does not deliver events in order.
    const outcome = await applyProviderEvent(envelope, stored.tenantId);
    if (outcome.applied) {
      console.log(
        `[whop-webhook] tenant ${stored.tenantId}: ${outcome.previousStatus} -> ${outcome.newStatus} (${envelope.type})`,
      );
    }

    await markProcessed(stored.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markFailed(stored.id, message);
    } catch (failureUpdateError) {
      // Do not turn a state-write failure into a false acknowledgement. The original handler
      // error remains the response reason; the secondary error is retained in server logs.
      console.error(`[whop-webhook] could not persist failure for ${stored.id}:`, failureUpdateError);
    }
    console.error(`[whop-webhook] handling ${envelope.type} failed:`, error);
    // Leave processed_at null and ask for the retry — the store treats an unprocessed repeat as
    // work still to do rather than as a duplicate.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, type: envelope.type, tenantId: stored.tenantId });
}

/**
 * After an invoice settled from a provider payment: the entitlement cache follows a reactivated
 * subscription, and money that moved somewhere it should not have is said out loud.
 */
async function finishInvoiceSettlement(settlement: ProviderSettlement, envelope: { data?: Record<string, unknown> }) {
  console.log(
    `[whop-webhook] invoice ${settlement.invoiceNumber} ${settlement.settled ? "settled" : `now ${settlement.status}`} by payment ${String(envelope.data?.id ?? "?")} (${settlement.paidCents} cents received)`,
  );
  if (settlement.anomaly) {
    console.error(`[whop-webhook] invoice ${settlement.invoiceNumber} for tenant ${settlement.tenantId}: ${settlement.anomaly} — needs a refund or a credit`);
  }
  if (settlement.subscriptionActivated) {
    // Outside the settlement transaction on purpose, as in the manual mark-paid route: the
    // entitlement is a cache, and failing the money because the cache could not be rebuilt would
    // be worse. rebuildEntitlement logs loudly on its own.
    await rebuildEntitlement(settlement.tenantId, "subscription.plan_changed");
  }
}

/** Whop only ever POSTs. A GET here is someone poking at the URL. */
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
