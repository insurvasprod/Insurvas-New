import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_CONFIGURE_PROVIDER } from "@/lib/payments/permissions";
import { isInFlight, type WhopEnvelope } from "@/lib/payments/whop/events";
import { processWhopEvent } from "@/lib/payments/whop/process";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Replay a stuck provider webhook (admin round 1, billing-r2 screen 12): runs today's processor
 * (lib/payments/whop/process.ts, the webhook route's own steps) once more on the event as it was stored when Whop
 * delivered it — signature already verified then, payload unchanged since.
 *
 * Super admin only, as the Payment provider page. Refused for an event already processed, and for one stored moments
 * ago and still being handled by its own delivery (the in-flight rule the webhook route uses). The request is audited
 * before anything runs, so the trail exists even if the processor throws; the outcome is the processor's own, and a
 * failure is recorded on the event as a delivery's failure would be.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_CONFIGURE_PROVIDER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Unknown event" }, { status: 404 });

  const { data: event, error } = await getSupabaseServiceClient()
    .from("webhook_events")
    .select("id, provider, event_id, event_type, payload, tenant_id, processed_at, process_error, attempts, received_at")
    .eq("id", id)
    .maybeSingle<{ id: string; provider: string; event_id: string; event_type: string; payload: unknown; tenant_id: string | null; processed_at: string | null; process_error: string | null; attempts: number | null; received_at: string | null }>();
  if (error) return NextResponse.json({ error: `Could not read the event: ${error.message}` }, { status: 500 });
  if (!event || event.provider !== "whop") return NextResponse.json({ error: "Unknown event" }, { status: 404 });
  if (event.processed_at !== null) return NextResponse.json({ error: "This event was already processed; replaying it would do nothing." }, { status: 409 });
  if (isInFlight(event)) return NextResponse.json({ error: "This event arrived moments ago and is still being handled. Try again in a minute." }, { status: 409 });

  const envelope = event.payload as WhopEnvelope | null;
  if (!envelope || typeof envelope !== "object" || typeof envelope.type !== "string") {
    return NextResponse.json({ error: "The stored payload is not an event the processor can read." }, { status: 422 });
  }

  try {
    await audit({
      actorId: auth.session.sub,
      action: "payment_provider.webhook_replayed",
      targetType: "webhook_event",
      targetId: event.id,
      metadata: { provider: "whop", eventId: event.event_id, eventType: event.event_type, tenantId: event.tenant_id, attempts: event.attempts ?? 0, previousError: event.process_error },
      request,
    });
  } catch {
    return NextResponse.json({ error: "The audit entry could not be written, so nothing was replayed." }, { status: 500 });
  }

  const outcome = await processWhopEvent({ id: event.id, tenantId: event.tenant_id }, envelope);
  if (!outcome.ok) return NextResponse.json({ ok: false, error: `It failed again: ${outcome.error}` }, { status: 200 });
  return NextResponse.json({ ok: true, result: outcome.result });
}
