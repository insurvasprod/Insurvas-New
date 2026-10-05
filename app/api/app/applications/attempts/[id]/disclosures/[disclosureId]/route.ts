import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { resolveDisclosure } from "@/lib/applications/mutations";
import { disclosureSchema } from "@/lib/applications/schemas";

/** LA-3.10 · acknowledge a disclosure (how it was given is recorded) or mark it not applicable (a reason is required). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; disclosureId: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id, disclosureId } = await params;
  if (!isUuid(id) || !isUuid(disclosureId)) return NextResponse.json({ error: "That disclosure could not be found." }, { status: 404 });
  const input = await body(request, disclosureSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await resolveDisclosure(actor, id, disclosureId, { status: input.status, method: input.method ?? null, note: input.note ?? null }));
  } catch (error) {
    return failure(error);
  }
}
