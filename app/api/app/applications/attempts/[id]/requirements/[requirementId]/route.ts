import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { updateRequirementSchema } from "@/lib/applications/afterSubmitSchemas";
import { updateRequirement } from "@/lib/applications/requirements";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.18 / 3.25 · status, due date, notes and — on a paramed exam only — the exam dates. Never moves the attempt. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, requirementId } = await params;
  if (!isUuid(id) || !isUuid(requirementId)) return NextResponse.json({ error: "That requirement could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const input = await body(request, updateRequirementSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await updateRequirement(actor, id, requirementId, input));
  } catch (error) {
    return failure(error);
  }
}
