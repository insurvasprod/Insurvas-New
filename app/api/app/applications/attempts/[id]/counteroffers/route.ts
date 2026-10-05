import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { recordCounterofferSchema } from "@/lib/applications/afterSubmitSchemas";
import { listCounteroffers, recordCounteroffer } from "@/lib/applications/counteroffers";

const NOT_FOUND = { error: "That application could not be found." };

/** LA-3.26 · every counteroffer on the attempt, with effective dates and the estimated FYC for both sides. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    return NextResponse.json({ counteroffers: await listCounteroffers(actor.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/** LA-3.26 · record the carrier's different terms beside the application; raises a waiting-on-client requirement. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const input = await body(request, recordCounterofferSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await recordCounteroffer(actor, id, input), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
