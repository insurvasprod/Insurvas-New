import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { syncHouseholdFromPrimary } from "@/lib/applications/household";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { demoteIfFailing, saveDraftDay } from "@/lib/applications/mutations";
import { draftDaySchema } from "@/lib/applications/schemas";

/**
 * LA-3.9 · the draft day. The recommendation is recomputed on the server; a day that differs from it
 * needs a reason, and the override is audited — the overrides are the dataset that later proves
 * whether the warning was right.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, draftDaySchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await saveDraftDay(actor, id, { day: input.day, incomeType: input.income_type, incomeInputs: input.income_inputs, overrideReason: input.override_reason ?? null });
    await demoteIfFailing(actor, id);
    // LA-3.24 · a spouse application sharing this detail follows it. The save above already stands.
    await syncHouseholdFromPrimary(actor.tenantId, id, actor.userId).catch((error) => console.error("household sync failed", error));
    return NextResponse.json(saved);
  } catch (error) {
    return failure(error);
  }
}
