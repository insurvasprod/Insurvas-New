import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { ensureInterview, saveMedications } from "@/lib/applications/mutations";
import { medicationsSchema } from "@/lib/applications/schemas";

/** LA-3.2 · medications as rows — name, dose, since, prescribed for — never one string. */
export async function PUT(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { caseId } = await params;
  if (!isUuid(caseId)) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const input = await body(request, medicationsSchema);
  if (input instanceof NextResponse) return input;
  try {
    const interviewId = await ensureInterview(actor, caseId, input.insured_role);
    return NextResponse.json({ interviewId, ...(await saveMedications(actor, interviewId, input.medications)) });
  } catch (error) {
    return failure(error);
  }
}
