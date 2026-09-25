import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scoringAgents, scoringQueuePreview } from "@/lib/scoring/service";

/**
 * GET /api/app/scoring/preview?agent=<user id> — "Preview the queue" on the scoring screen.
 *
 * The next leads Serve next would hand the chosen agent, with the tier reason, the scorer's reasons
 * and the score, plus the due leads the calling window is holding back. Owner and producer, like the
 * rest of the scoring surface: the score is shown here and never to an agent.
 *
 * Read-only: scoring_queue_preview claims nothing and records no scoring decision, so a GET is right
 * and read-only accounts may look. The agent must be a dialing member of THIS tenant — the function
 * takes any id, and a foreign one would answer with this tenant's queue filtered by another
 * tenant's licences.
 */
const SCORING_ROLES = ["owner", "producer"] as const;

const querySchema = z.object({ agent: z.string().uuid().optional() });

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", SCORING_ROLES);
  if (auth instanceof NextResponse) return auth;
  const parsed = querySchema.safeParse({ agent: request.nextUrl.searchParams.get("agent") || undefined });
  if (!parsed.success) return NextResponse.json({ error: "Choose an agent from the list" }, { status: 400 });

  try {
    const agents = await scoringAgents(auth.context.tenantId);
    // Default to the viewer when they dial, else the first member, so the first open shows something.
    const agentId = parsed.data.agent
      ?? agents.find((agent) => agent.userId === auth.context.userId)?.userId
      ?? agents[0]?.userId
      ?? null;
    if (agentId && !agents.some((agent) => agent.userId === agentId))
      return NextResponse.json({ error: "That agent is not a dialing member of this agency" }, { status: 400 });
    if (!agentId) return NextResponse.json({ agents, agentId: null, preview: null, available: true }, { headers: { "Cache-Control": "no-store" } });

    const preview = await scoringQueuePreview(auth.context.tenantId, agentId);
    return NextResponse.json(
      { agents, agentId, preview, available: preview !== null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not preview the queue" },
      { status: 500 },
    );
  }
}
