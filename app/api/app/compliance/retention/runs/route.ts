import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { acknowledgeDryRun, RetentionError, runRetention } from "@/lib/compliance/retentionStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.6 (Notion sprint) · run the retention engine now. A dry run deletes nothing and reports what
 * would go; a live run deletes, and the database refuses it without a dry run inside the window
 * whose summary someone saw and whose rules are still the rules. `acknowledge` records that the
 * owner has read a scheduled dry run's summary (when its email reached nobody).
 */
const body = z.union([
  z.object({ mode: z.enum(["dry_run", "live"]), confirm: z.boolean().optional() }).strict(),
  z.object({ mode: z.literal("acknowledge"), run_id: z.string().uuid() }).strict(),
]);

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a dry run or a live run." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  if (parsed.data.mode === "acknowledge") {
    try {
      await acknowledgeDryRun(tenantId, userId, parsed.data.run_id);
      await audit({ actorType: "tenant", actorId: userId, action: "compliance.retention_run", targetType: "retention_run", targetId: parsed.data.run_id, metadata: { tenantId, acknowledged: true }, request });
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof RetentionError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error("[retention-run]", error);
      return NextResponse.json({ error: "The acknowledgement could not be saved" }, { status: 500 });
    }
  }
  if (parsed.data.mode === "live" && parsed.data.confirm !== true) return NextResponse.json({ error: "Confirm the live run: it deletes records for good." }, { status: 400 });
  try {
    const run = await runRetention(tenantId, parsed.data.mode, userId);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.retention_run", targetType: "retention_run", targetId: run.id, metadata: { tenantId, mode: run.mode, held: run.heldCount }, request });
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof RetentionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[retention-run]", error);
    return NextResponse.json({ error: "The run could not be completed" }, { status: 500 });
  }
}
