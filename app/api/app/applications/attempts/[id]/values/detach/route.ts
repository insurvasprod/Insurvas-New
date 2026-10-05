import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { detachSchema } from "@/lib/applications/afterSubmitSchemas";
import { detachShared } from "@/lib/applications/household";

/** LA-3.24 · stop one shared value (addr.* / contact.*), the payment method or the draft day tracking the primary insured's. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, detachSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await detachShared(actor, id, input.field_key));
  } catch (error) {
    return failure(error);
  }
}
