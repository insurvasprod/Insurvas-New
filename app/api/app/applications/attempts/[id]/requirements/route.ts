import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { addRequirementSchema } from "@/lib/applications/afterSubmitSchemas";
import { addRequirement, ageingDays, attemptHead, requirementCallbacks } from "@/lib/applications/requirements";

const NOT_FOUND = { error: "That application could not be found." };

/** LA-3.18 · the tenant's ageing threshold and the callbacks this attempt's requirements booked. The rows ride on the case read. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    await attemptHead(actor.tenantId, id, { allowClosed: true });
    const [days, callbacks] = await Promise.all([ageingDays(actor.tenantId), requirementCallbacks(actor.tenantId, id)]);
    return NextResponse.json({ ageingDays: days, callbacks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/** LA-3.18 · add what the carrier asked for. The first one moves the attempt to pending_carrier. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const input = await body(request, addRequirementSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await addRequirement(actor, id, input), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
