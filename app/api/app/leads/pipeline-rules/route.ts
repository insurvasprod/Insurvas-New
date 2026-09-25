import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { MoveError, setPipelineStatus, updateStageRules } from "@/lib/pipelines/views";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The two pipeline settings the views add (migration 20260925100000): a stage's time allowed and
 * counts-as-worked flag, and a pipeline's draft/live status. Owner only, like every other pipeline
 * setting (LA-1.9 criterion 1).
 */
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stage"), stage_id: z.string().uuid(), time_allowed_minutes: z.number().int().nullable().optional(), counts_as_worked: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("pipeline_status"), pipeline_id: z.string().uuid(), status: z.enum(["draft", "live"]) }).strict(),
]);

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Write a valid pipeline setting" }, { status: 400 });
  try {
    if (parsed.data.kind === "stage") {
      await updateStageRules(auth.context.tenantId, parsed.data.stage_id, { timeAllowedMinutes: parsed.data.time_allowed_minutes, countsAsWorked: parsed.data.counts_as_worked });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_stage_updated", targetType: "pipeline_stage", targetId: parsed.data.stage_id, metadata: { timeAllowedMinutes: parsed.data.time_allowed_minutes, countsAsWorked: parsed.data.counts_as_worked }, request });
    } else {
      await setPipelineStatus(auth.context.tenantId, parsed.data.pipeline_id, parsed.data.status);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_updated", targetType: "pipeline", targetId: parsed.data.pipeline_id, metadata: { status: parsed.data.status }, request });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof MoveError && error.code === "schema_pending" ? 503 : error instanceof MoveError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save", code: error instanceof MoveError ? error.code : undefined }, { status });
  }
}
