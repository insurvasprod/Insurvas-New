import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { chaseRequirement } from "@/lib/applications/requirements";

/** LA-3.18 · one click: chase_count + 1 and last_chased_at = now. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, requirementId } = await params;
  if (!isUuid(id) || !isUuid(requirementId)) return NextResponse.json({ error: "That requirement could not be found." }, { status: 404 });
  try {
    return NextResponse.json(await chaseRequirement(actor, id, requirementId));
  } catch (error) {
    return failure(error);
  }
}
