import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { loadPending } from "@/lib/applications/pending";
import { scopeFor } from "@/lib/agency/visibility";
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
    // AG-0.5 · requirements, counteroffers and awaiting-number rows on the visible producers' cases only.
    return NextResponse.json(await loadPending(actor.tenantId, Date.now(), await scopeFor(auth.context)));
  } catch (error) {
    return failure(error);
  }
}
