import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { demoteIfFailing, saveBeneficiaries } from "@/lib/applications/mutations";
import { beneficiariesSchema } from "@/lib/applications/schemas";

/** LA-3.8 · replace the beneficiary set. Shares are hundredths of a percent; totals are checked by QA and the `ready` guard. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, beneficiariesSchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await saveBeneficiaries(actor, id, input.beneficiaries.map((b) => ({ ...b, relationship_other: b.relationship_other ?? undefined, dob: b.dob ?? null, phone: b.phone ?? null })));
    await demoteIfFailing(actor, id);
    return NextResponse.json(saved);
  } catch (error) {
    return failure(error);
  }
}
