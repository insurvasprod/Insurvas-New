import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { closeCase } from "@/lib/applications/mutations";
import { closeCaseSchema } from "@/lib/applications/schemas";

/** LA-3.16 · close a case as lost. Only explicitly, with a reason, and only with no live attempt. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const input = await body(request, closeCaseSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await closeCase(actor, caseId, { reasonCode: input.reason_code, reasonText: input.reason_text ?? null }));
  } catch (error) {
    return failure(error);
  }
}
