import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { MoveError, moveLeadWithDisposition } from "@/lib/pipelines/views";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Move leads between stages by applying a disposition — the board drop, the table's bulk change and
 * the list's quick actions. A stage change with no disposition is not accepted here.
 *
 * Many leads, one disposition: each lead is moved and logged on its own, so a bulk change writes one
 * history row and one audit entry per lead, and a lead that cannot move does not stop the rest.
 */
const schema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(200),
  disposition_key: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
  source: z.enum(["board", "table", "list", "lead_detail"]),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose leads and a disposition" }, { status: 400 });
  const { lead_ids: leadIds, disposition_key: dispositionKey, source } = parsed.data;

  const moved: Array<{ lead_id: string; from_stage_id: string | null; to_stage_id: string; recorded: boolean }> = [];
  const failed: Array<{ lead_id: string; code: string; error: string }> = [];
  for (const leadId of [...new Set(leadIds)]) {
    try {
      const result = await moveLeadWithDisposition({ tenantId: auth.context.tenantId, leadId, dispositionKey, actorId: auth.context.userId, source });
      moved.push({ lead_id: leadId, from_stage_id: result.fromStageId, to_stage_id: result.toStageId, recorded: result.recorded });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: leadId, metadata: { operation: "disposition_move", source, dispositionKey, fromStageId: result.fromStageId, stageId: result.toStageId }, request });
    } catch (error) {
      // A refusal that applies to every lead (a callback, do-not-call, an unmapped outcome) is the
      // same for all of them; stop at the first rather than repeating it two hundred times.
      if (error instanceof MoveError && ["call_path_only", "disposition_not_found", "disposition_not_active", "disposition_not_mapped"].includes(error.code)) {
        return NextResponse.json({ error: error.message, code: error.code, moved, failed }, { status: moved.length ? 207 : 409 });
      }
      failed.push({ lead_id: leadId, code: error instanceof MoveError ? error.code : "move_failed", error: error instanceof Error ? error.message : "Could not move the lead" });
    }
  }
  return NextResponse.json({ moved, failed }, { status: failed.length && !moved.length ? 409 : 200 });
}
