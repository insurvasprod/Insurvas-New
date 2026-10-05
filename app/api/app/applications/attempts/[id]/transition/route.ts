import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { transition } from "@/lib/applications/mutations";
import { transitionSchema } from "@/lib/applications/schemas";

/**
 * LA-3 · move an attempt (STATUS-MODEL §4). `ready` is refused while QA fails. `submitted` is not
 * here — it happens only through the submission capture. Recording `issued` attaches the policy
 * number to Module 4 through the existing issued-policy RPC; issue is never inferred.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, transitionSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await transition(actor, id, { to: input.to, outcome: input.outcome ?? null, reasonCode: input.reason_code ?? null, reasonText: input.reason_text ?? null, policyNumber: input.policy_number ?? null, issuedOn: input.issued_on ?? null }));
  } catch (error) {
    return failure(error);
  }
}
