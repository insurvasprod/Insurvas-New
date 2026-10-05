import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { chaseRequirement } from "@/lib/applications/pending";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.18 · "Log a chase", one click: chase_count + 1, last_chased_at = now, last_chased_by = the
 * agent. No body. POST and PATCH do the same thing (the board's button posts).
 */
async function chase(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That requirement could not be found." }, { status: 404 });
  try {
    return NextResponse.json(await chaseRequirement(actor, id));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return chase(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return chase(request, context);
}
