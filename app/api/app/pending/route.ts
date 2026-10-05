import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { loadPending } from "@/lib/applications/pending";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.18 / 3.26 / 3.15 · Pending cases: open requirements across the tenant, counteroffers waiting
 * on the client, and submitted applications still missing a carrier number. No sensitive value.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    return NextResponse.json(await loadPending(actor.tenantId));
  } catch (error) {
    return failure(error);
  }
}
