import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { selectQuote } from "@/lib/applications/mutations";
import { quoteCaseId } from "@/lib/applications/lists";
import { guardCase } from "@/lib/agency/guards";

/**
 * LA-3.5 · select one quote for the open attempt. The others become discarded and are kept — the
 * discarded set is the record of what was offered. The payout ranking never calls this.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That quote could not be found." }, { status: 404 });
  // AG-0.5 · a quote follows its case's producer; one on another producer's case is not found.
  const hidden = await guardCase(auth.context, (await quoteCaseId(actor.tenantId, id)) ?? id);
  if (hidden) return hidden;
  try {
    return NextResponse.json(await selectQuote(actor, id));
  } catch (error) {
    return failure(error);
  }
}
