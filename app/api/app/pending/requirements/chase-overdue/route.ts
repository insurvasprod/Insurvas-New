import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { chaseOverdue } from "@/lib/applications/pending";
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
    return NextResponse.json(await chaseOverdue(actor));
  } catch (error) {
    return failure(error);
  }
}
