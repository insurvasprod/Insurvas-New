import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  ScrubCampaignNotFoundError,
  ScrubInProgressError,
  ScrubLeaseLostError,
  ScrubSchemaPendingError,
  startScrubRun,
  stepScrubRun,
} from "@/lib/campaigns/scrubRun";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * "Run the scrub" (Campaigns concept audit, LA-2 §5). OWNER ONLY: it re-screens every lead in the
 * campaign against the litigator and DNC vendors, and every lookup is billed to the agency's
 * screening meters. A producer sees the run's progress on the campaign list; only an owner starts,
 * drives or resumes one.
 *
 *   POST { action: "start", token }          open the run (or resume the open one); the campaign
 *                                            stops serving until it ends
 *   POST { action: "step", token, runId }    screen the next batch
 *
 * `token` is the driving window's own id. The run refuses a step from any other token, so two tabs
 * cannot both bill the same batch; a run with no progress for 15 minutes can be taken over.
 */
const roles = ["owner"] as const;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), token: z.string().uuid() }).strict(),
  z.object({ action: z.literal("step"), token: z.string().uuid(), runId: z.string().uuid() }).strict(),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Choose a valid campaign" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That is not a scrub request" }, { status: 400 });

  try {
    if (parsed.data.action === "start") {
      const run = await startScrubRun({ tenantId: auth.context.tenantId, campaignId: id, userId: auth.context.userId, token: parsed.data.token, request });
      return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store" } });
    }
    const stepped = await stepScrubRun({
      tenantId: auth.context.tenantId,
      campaignId: id,
      runId: parsed.data.runId,
      userId: auth.context.userId,
      token: parsed.data.token,
      request,
    });
    // A plan cap is not an outage: the run ended `failed` with the reason, and the caller also gets
    // the standard limit payload so the screen can offer the upgrade.
    if (stepped.limit) return NextResponse.json({ ...stepped.limit, run: stepped.run }, { status: 403 });
    return NextResponse.json({ run: stepped.run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ScrubSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    if (error instanceof ScrubInProgressError) return NextResponse.json({ error: error.message, code: "scrub_in_progress" }, { status: 409 });
    if (error instanceof ScrubLeaseLostError) return NextResponse.json({ error: error.message, code: "scrub_lease_lost" }, { status: 409 });
    if (error instanceof ScrubCampaignNotFoundError) return NextResponse.json({ error: error.message, code: "campaign_not_found" }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The scrub could not be run" }, { status: 500 });
  }
}
