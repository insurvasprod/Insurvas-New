import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { syncHouseholdFromPrimary } from "@/lib/applications/household";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { demoteIfFailing, markReviewed, saveValues } from "@/lib/applications/mutations";
import { patchValuesSchema } from "@/lib/applications/schemas";

/**
 * LA-3.7 · save canonical values and confirm prefilled ones. Sensitive keys and coverage keys are
 * refused here — the SSN has its own encrypted path and coverage comes from the selected quote.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, patchValuesSchema);
  if (input instanceof NextResponse) return input;
  try {
    if (input.values.length) await saveValues(actor, id, input.values);
    if (input.reviewed.length) await markReviewed(actor, id, input.reviewed);
    await demoteIfFailing(actor, id);
    // LA-3.24 · a spouse application sharing this detail follows it. The save above already stands.
    await syncHouseholdFromPrimary(actor.tenantId, id, actor.userId).catch((error) => console.error("household sync failed", error));
    return NextResponse.json({ saved: input.values.length, reviewed: input.reviewed.length });
  } catch (error) {
    return failure(error);
  }
}
