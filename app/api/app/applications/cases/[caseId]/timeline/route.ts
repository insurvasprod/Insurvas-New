import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { caseTimeline } from "@/lib/applications/timeline";
import { guardCase } from "@/lib/agency/guards";

/** LA-3.16 · everything that happened on the case, newest first. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardCase(auth.context, caseId);
  if (hidden) return hidden;
  try {
    return NextResponse.json({ events: await caseTimeline(actor.tenantId, caseId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
