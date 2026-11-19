import { NextResponse, type NextRequest } from "next/server";

import { verifyWhopSignature } from "@/lib/payments/whop/verify";
import { parseEnvelope } from "@/lib/payments/whop/events";
import { processWhopEvent } from "@/lib/payments/whop/process";
import { recordWebhookEvent } from "@/lib/payments/whop/store";

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

  // Everything after the store step is the shared processor, which Admin › Billing › Payment provider's Replay also
  // runs on a stuck event, so the two can never drift (lib/payments/whop/process.ts).
  const outcome = await processWhopEvent({ id: stored.id, tenantId: stored.tenantId }, envelope);
  if (!outcome.ok) {
    // Leave processed_at null and ask for the retry — the store treats an unprocessed repeat as work still to do
    // rather than as a duplicate.
    return NextResponse.json({ error: outcome.stage === "record" ? "Could not record event" : "Handler failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}

/** Whop only ever POSTs. A GET here is someone poking at the URL. */
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
