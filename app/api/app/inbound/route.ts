import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { inboxRowFacts } from "@/lib/transferInbox/inboxExtras";
import { getInboxSummaryFallback, getTransferInbox } from "@/lib/transferInbox/service";

const safeFilter = (label: string, max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f<>]+$/, `${label} contains unsupported characters`);

const filtersSchema = z.object({
  status: z.enum(["unclaimed", "claimed", "all"]).default("unclaimed"),
  partner_id: z.string().uuid().optional(),
  product_line: safeFilter("Product", 100).optional(),
  state: safeFilter("State", 20).optional(),
  screening_outcome: safeFilter("Screening result", 80).optional(),
  claimed_by: z.union([z.literal("me"), z.string().uuid()]).optional(),
});

/**
 * The inbox re-reads on every realtime change; the SLA ladder changes when an owner edits it. Held for 30 seconds
 * per tenant in this server instance, so an edit shows up within half a minute without a query on
 * every tick.
 */
const SLA_CACHE_MS = 30_000;
const slaCache = new Map<string, { at: number; value: { warnSeconds: number; escalateSeconds: number } | null }>();
async function queueSla(tenantId: string) {
  const cached = slaCache.get(tenantId);
  if (cached && Date.now() - cached.at < SLA_CACHE_MS) return cached.value;
  const value = await getQueueSlaSettings(tenantId).then((settings) => ({ warnSeconds: settings.warn_after_seconds, escalateSeconds: settings.escalate_after_seconds })).catch(() => null);
  slaCache.set(tenantId, { at: Date.now(), value });
  return value;
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose valid inbox filters" }, { status: 400 });
  try {
    // The queue SLA is the tenant's own ladder (Settings › Queue & SLA), read alongside the inbox.
    // A failure there never blocks the inbox: the tiles then say the target is unavailable.
    // Row facts (open call, logged outcome, escalation) are extra: a failure leaves the rows plain.
    const [data, sla, rowFacts] = await Promise.all([
      getTransferInbox(auth.context.tenantId, { status: parsed.data.status, partnerId: parsed.data.partner_id, productLine: parsed.data.product_line, state: parsed.data.state, screeningOutcome: parsed.data.screening_outcome, claimedBy: parsed.data.claimed_by }, auth.context.userId, auth.context.role),
      queueSla(auth.context.tenantId),
      inboxRowFacts(auth.context.tenantId).catch(() => ({})),
    ]);
    // Before 20260924335200 the bundle has no summary; compute the same numbers the slower way.
    const summary = data.summary ?? await getInboxSummaryFallback(auth.context.tenantId).catch(() => null);
    return NextResponse.json({ ...data, rowFacts, summary, sla, realtimeTopic: `agent-floor:${auth.context.tenantId}`, currentUserId: auth.context.userId, readOnly: auth.entitlement.status === "suspended" || auth.entitlement.status === "paused", fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load transfer inbox" }, { status: 500 });
  }
}
