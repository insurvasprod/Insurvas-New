import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readRoster } from "@/lib/agency/producerStore";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AG-1.1 · the producer roster. Read through the AG-0.4 scope: the owner, an admin and the bookkeeper see every
 * producer; a manager sees his direct reports; a producer sees only himself (the page sends him to his own
 * record instead of a roster).
 */
export async function GET() {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const roster = await readRoster(auth.context);
    return NextResponse.json(roster, { headers: NO_STORE });
  } catch (error) {
    console.error("[agency roster]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load your producers" }, { status: 500 });
  }
}
