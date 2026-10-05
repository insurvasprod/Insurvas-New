import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialerWorkflowError, diagnoseEmptyQueue, getDialerStats, getQueuePreview } from "@/lib/dialerScripts/service";
import { PRIORITY_TIERS } from "@/lib/dialerScripts/display";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// The same roles as every dialer route (a test pins them to rolesWith("dialer.use")). A literal
// array because the money-route guard reads these lists statically.
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

const querySchema = z.object({ priority: z.enum(["all", "high", "medium", "low"]).default("all") });

/**
 * GET /api/app/dialer/queue — the Priority queue list.
 *
 * Read-only: dialer_queue_preview claims nothing and writes nothing, so a GET is right here (the
 * serve and the pick are POSTs because they lock). Bounded: the next 25 servable leads in tier
 * order and a count capped at 1,000. The High / Medium / Low filter narrows this list only; Serve
 * next is unaffected by it. Read-only accounts may look, since looking changes nothing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const parsed = querySchema.safeParse({ priority: request.nextUrl.searchParams.get("priority") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Choose All, High, Medium or Low" }, { status: 400 });
  const tiers = parsed.data.priority === "high" ? PRIORITY_TIERS.High : parsed.data.priority === "medium" ? PRIORITY_TIERS.Medium : parsed.data.priority === "low" ? PRIORITY_TIERS.Low : null;
  try {
    // The header's own-today figures ride along: the screen reloads this after every serve and
    // disposition, which is exactly when they change. A failed count is null, never a fake 0.
    const [preview, stats] = await Promise.all([
      getQueuePreview({ tenantId: auth.context.tenantId, agentId: auth.context.userId, tiers }),
      getDialerStats({ tenantId: auth.context.tenantId, agentId: auth.context.userId }).catch(() => null),
    ]);
    // An empty list says why (LA-2.8-6), read-only: the same diagnosis Serve next gives, without
    // pressing it. Only for the whole list; a priority filter that is empty is just a filter.
    const empty = preview.available && preview.count === 0 && tiers === null
      ? await diagnoseEmptyQueue(auth.context.tenantId, auth.context.userId).catch(() => null)
      : null;
    return NextResponse.json({ ...preview, stats, emptyReason: empty?.message ?? null, emptyCode: empty?.code ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DialerWorkflowError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the queue" }, { status });
  }
}
