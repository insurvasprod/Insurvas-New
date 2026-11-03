import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getQueueSlaSettings } from "@/lib/queueSla/service";
import { scopeFor } from "@/lib/agency/visibility";
import { getTransferInbox } from "@/lib/transferInbox/service";
import { screeningSignal } from "@/lib/transferInbox/constants";

/** How many waiting transfers the card needs: the one it offers, and a count of the rest. */
const SHOWN = 5;

/**
 * The live-transfer card's read (Inbound A, redesign 2026-10-25): the longest-waiting transfers and
 * any handoff offered to this person, on every page of the shell. The inbox's own read also builds
 * team-wide row facts and a summary; this one skips both, because it runs for every agent on every
 * page. The same bundle, the same AG-0.5 scope (waiting transfers are claimable by anyone who takes
 * transfers; claimed rows never appear here), the same roles as the inbox.
 */
export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const scope = await scopeFor(auth.context);
    const [data, sla] = await Promise.all([
      getTransferInbox(auth.context.tenantId, { status: "unclaimed" }, auth.context.userId, auth.context.role, scope),
      getQueueSlaSettings(auth.context.tenantId).then((settings) => ({ warnSeconds: settings.warn_after_seconds, escalateSeconds: settings.escalate_after_seconds })).catch(() => null),
    ]);
    const waiting = data.items
      .filter((item) => item.status === "unclaimed")
      .sort((a, b) => b.waitSeconds - a.waitSeconds);
    return NextResponse.json({
      count: waiting.length,
      items: waiting.slice(0, SHOWN).map((item) => ({
        id: item.id,
        customer: item.customer,
        productLine: item.productLine,
        partnerName: item.partnerName,
        state: item.state,
        waitSeconds: item.waitSeconds,
        screening: screeningSignal({ screeningOutcome: item.screeningOutcome, preflightStatus: item.preflightStatus, duplicateWarning: item.duplicateWarning }).label,
      })),
      // A buffer agent's handoff waits for one named licensed agent: only theirs are listed.
      handoffs: auth.context.role === "assistant" ? [] : data.handoffs.map((handoff) => ({ id: handoff.id, workItemId: handoff.workItemId, bufferName: handoff.bufferName, customer: handoff.customer, productLine: handoff.productLine, progressPercentage: handoff.progressPercentage, expiresAt: handoff.expiresAt })),
      sla,
      realtimeTopic: `agent-floor:${auth.context.tenantId}`,
      readOnly: auth.entitlement.status === "suspended" || auth.entitlement.status === "paused",
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load waiting transfers" }, { status: 500 });
  }
}
