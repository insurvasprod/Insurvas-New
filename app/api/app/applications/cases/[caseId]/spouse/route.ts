import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { addSpouseSchema } from "@/lib/applications/afterSubmitSchemas";
import { addSpouse } from "@/lib/applications/household";

/** LA-3.24 · the spouse's own attempt on this case, sharing only address, contact, payment and draft day. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const input = await body(request, addSpouseSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await addSpouse(actor, caseId, input), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
