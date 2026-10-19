import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { respondCounterofferSchema } from "@/lib/applications/afterSubmitSchemas";
import { respondCounteroffer } from "@/lib/applications/counteroffers";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.26 · the client accepts (→ pending_carrier, new effective coverage), refuses (declined_by_client) or lets it expire (offer_expired). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; counterofferId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, counterofferId } = await params;
  if (!isUuid(id) || !isUuid(counterofferId)) return NextResponse.json({ error: "That counteroffer could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const input = await body(request, respondCounterofferSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await respondCounteroffer(actor, id, counterofferId, input));
  } catch (error) {
    return failure(error);
  }
}
