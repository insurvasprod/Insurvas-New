import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { RecyclingNotApplied, RecyclingRefused, saveNurtureRule, screenRecycleChunk, startRecycleBatch } from "@/lib/nurture/service";
import { nurtureReport } from "@/lib/nurture/report";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const ROLES = ["owner", "producer"] as const;
const ruleSchema = z.object({ action: z.literal("save_rule"), campaign_id: z.string().uuid(), wait_days: z.number().int(), allowed_dispositions: z.array(z.string()), max_recycles: z.number().int() });
// A batch (20260925706500): the angle is required, the script optional, the pass ceiling 1–7.
const startSchema = z.object({ action: z.literal("start_batch"), campaign_id: z.string().uuid(), angle: z.string().max(500), script: z.string().max(5000).nullable().optional(), attempt_ceiling: z.number().int().min(1).max(7).optional() });
// The page drives the screening a chunk at a time; progress is in the database.
const chunkSchema = z.object({ action: z.literal("screen_chunk"), batch_id: z.string().uuid() });

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", ROLES);
  if (auth instanceof NextResponse) return auth;
  // The report carries the campaigns (same shape as before) plus the figures the board shows around them.
  try { const report = await nurtureReport(auth.context.tenantId, { userId: auth.context.userId, role: auth.context.role }); return NextResponse.json({ ...report, readOnly: auth.entitlement.access === "read_only" }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load nurture" }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  const parsed = ruleSchema.safeParse(body);
  const start = startSchema.safeParse(body);
  const chunk = chunkSchema.safeParse(body);
  try {
    if (parsed.success) {
      return NextResponse.json({ rule: await saveNurtureRule(auth.context.tenantId, auth.context.userId, parsed.data.campaign_id, { waitDays: parsed.data.wait_days, allowedDispositions: parsed.data.allowed_dispositions, maxRecycles: parsed.data.max_recycles }) });
    }
    if (start.success) {
      return NextResponse.json(await startRecycleBatch(auth.context.tenantId, auth.context.userId, start.data.campaign_id, { angle: start.data.angle, script: start.data.script ?? null, attemptCeiling: start.data.attempt_ceiling ?? null }));
    }
    if (chunk.success) return NextResponse.json(await screenRecycleChunk(auth.context.tenantId, auth.context.userId, chunk.data.batch_id));
    return NextResponse.json({ error: "Choose a valid nurture action" }, { status: 400 });
  } catch (error) {
    if (error instanceof RecyclingNotApplied) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof RecyclingRefused) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update nurture" }, { status: 400 });
  }
}
