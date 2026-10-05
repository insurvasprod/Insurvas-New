import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { disclosureTriggers } from "@/lib/applications/reviewReads";

/** LA-3.10 · why each disclosure on this attempt applies: its state/carrier scope and its rules. Read only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ triggers: await disclosureTriggers(actor.tenantId, id) });
  } catch (error) {
    return failure(error);
  }
}
