import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SchemaPendingError, schemaPendingBody } from "@/lib/appointments/pendingSchema";
import { DialerWorkflowError, serveLeadById, serveLeadByLeadId } from "@/lib/dialerScripts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// The same roles as every dialer route (a test pins them to rolesWith("dialer.use")). A literal
// array because the money-route guard reads these lists statically.
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

// `lead_id` is the "Call now" link (/app/dialer?lead=…): the lead's open work item is found and
// picked exactly as a queue row would be — the same function, the same gates, the same refusals.
const schema = z.union([z.object({ work_item_id: z.string().uuid() }).strict(), z.object({ lead_id: z.string().uuid() }).strict()]);

/**
 * POST /api/app/dialer/pick — serve THIS lead from the Priority queue.
 *
 * User decision 2026-09-24: the queue list is clickable, so an agent chooses whom to call. The
 * choice is a serve, not a read: serve_lead_by_id locks the queue row and applies every gate
 * serve_next_lead applies (calling window, suppression and internal DNC, licence, campaign, a due
 * tier) before claiming it, so two agents cannot hold one lead and a pick cannot reach a lead Serve
 * next would refuse. POST for the same reason /next is: it claims and locks.
 *
 * A refused pick answers 409 with the server's reason, which the screen shows in the row.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a lead from the queue" }, { status: 400 });

  try {
    const result = "lead_id" in parsed.data
      ? await serveLeadByLeadId({ tenantId: auth.context.tenantId, agentId: auth.context.userId, leadId: parsed.data.lead_id })
      : await serveLeadById({ tenantId: auth.context.tenantId, agentId: auth.context.userId, workItemId: parsed.data.work_item_id });
    if (result.refusal) {
      return NextResponse.json({ served: null, error: result.refusal.message, code: result.refusal.code }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ served: result.served }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json(schemaPendingBody(), { status: 503 });
    const status = error instanceof DialerWorkflowError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not serve that lead" }, { status });
  }
}
