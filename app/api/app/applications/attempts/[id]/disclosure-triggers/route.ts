import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { disclosureTriggers } from "@/lib/applications/reviewReads";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.10 · why each disclosure on this attempt applies: its state/carrier scope and its rules. Read only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  try {
    return NextResponse.json({ triggers: await disclosureTriggers(actor.tenantId, id) });
  } catch (error) {
    return failure(error);
  }
}
