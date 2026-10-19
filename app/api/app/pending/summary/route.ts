import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { pendingSummary } from "@/lib/applications/pending";
import { scopeFor } from "@/lib/agency/visibility";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The dashboard card's three figures (LA-3.15, 3.18, 3.26): awaiting a policy number, waiting on
 * the client / overdue, counteroffers expiring. Counts only — computed from the same rows as
 * /app/pending, so the card and the page never disagree.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    // AG-0.5 · the counts are over the visible producers' rows, the same rows /app/pending lists.
    return NextResponse.json({ summary: await pendingSummary(actor.tenantId, await scopeFor(auth.context)) });
  } catch (error) {
    return failure(error);
  }
}
