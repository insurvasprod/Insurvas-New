import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { referenceCheckQuery } from "@/lib/applications/afterSubmitSchemas";
import { checkReference } from "@/lib/applications/confirmations";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.15 · before capture: the carrier's reference pattern, and the same reference on another application. Warnings only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const parsed = referenceCheckQuery.safeParse({ reference: new URL(request.url).searchParams.get("reference") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Enter the reference to check.", code: "invalid_request" }, { status: 400 });
  try {
    return NextResponse.json(await checkReference(actor.tenantId, id, parsed.data.reference), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
