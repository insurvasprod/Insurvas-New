import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { pendingSummary } from "@/lib/applications/pending";
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
    return NextResponse.json({ summary: await pendingSummary(actor.tenantId) });
  } catch (error) {
    return failure(error);
  }
}
