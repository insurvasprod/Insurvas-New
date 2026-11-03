import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { chaseOverdue } from "@/lib/applications/pending";
import { scopeFor } from "@/lib/agency/visibility";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.18 · "Chase everything overdue": one logged chase on every requirement past twice the
 * tenant's ageing threshold that nobody has chased today. Each one is audited on its own.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    // AG-0.5 · a producer chases his own overdue requirements, never another producer's.
    return NextResponse.json(await chaseOverdue(actor, Date.now(), await scopeFor(auth.context)));
  } catch (error) {
    return failure(error);
  }
}
