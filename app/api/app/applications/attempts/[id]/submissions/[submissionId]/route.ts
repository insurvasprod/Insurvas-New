import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { setSubmissionReference } from "@/lib/applications/mutations";
import { submissionReferenceSchema } from "@/lib/applications/schemas";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.15 · add the reference later, or the policy number at issue — without overwriting the application number. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; submissionId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, submissionId } = await params;
  if (!isUuid(id) || !isUuid(submissionId)) return NextResponse.json({ error: "That submission could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const input = await body(request, submissionReferenceSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await setSubmissionReference(actor, id, submissionId, { reference: input.reference, referenceKind: input.reference_kind, policyNumber: input.policy_number }));
  } catch (error) {
    return failure(error);
  }
}
