import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getCaseView } from "@/lib/applications/service";

/** LA-3 · one case, every attempt, masked. The workspace renders exactly this. */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  try {
    return NextResponse.json(await getCaseView(actor.tenantId, caseId));
  } catch (error) {
    return failure(error);
  }
}
