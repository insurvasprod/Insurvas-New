import { NextResponse } from "next/server";
import { z } from "zod";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { getStageMapActivity, moveDueCards, putCardBack } from "@/lib/salesSettings/stageMapActivity";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.23 · Settings › Application stages › Activity. Owners only — it names leads across every producer.
 *
 * GET `?pipeline=<id>`: the sync's recent moves on that pipeline and its 30-day count; `&check=1` also
 * evaluates the pipeline's open cases (cards a person is holding, cards due a move, states with nowhere
 * to go). Reads only.
 *
 * POST, on the owner's say-so (the screen asks first):
 *   `{ action: "move_due", pipeline_id }` — the due cards go where their application says;
 *   `{ action: "put_back", lead_id }` — one held card goes where its application says.
 * Both use the sync's own rules and write history rows with the owner as the actor. Applications are
 * never changed.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const pipeline = url.searchParams.get("pipeline") ?? "";
  if (!isUuid(pipeline)) return NextResponse.json({ error: "Choose one of your pipelines." }, { status: 400 });
  try {
    const activity = await getStageMapActivity(actorOf(auth, request), pipeline, url.searchParams.get("check") === "1");
    return NextResponse.json(activity, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move_due"), pipeline_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("put_back"), lead_id: z.string().uuid() }).strict(),
]);

export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, actionSchema);
  if (input instanceof NextResponse) return input;
  const actor = actorOf(auth, request);
  try {
    if (input.action === "move_due") return NextResponse.json(await moveDueCards(actor, input.pipeline_id));
    const result = await putCardBack(actor, input.lead_id);
    if (!result.moved) {
      const why = result.reason === "unmapped" ? "Its application's state has no stage on this pipeline." : result.reason === "already_there" ? "It is already where its application says." : result.reason === "stage_unavailable" ? "That stage was archived." : "The card moved meanwhile. Check again.";
      return NextResponse.json({ error: why, reason: result.reason }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
