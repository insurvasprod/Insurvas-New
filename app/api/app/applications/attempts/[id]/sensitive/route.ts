import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { demoteIfFailing, saveSensitiveValue } from "@/lib/applications/mutations";
import { putSensitiveSchema } from "@/lib/applications/schemas";
import { guardAttempt } from "@/lib/agency/guards";

/** LA-3.7 · store the SSN: validated, encrypted per tenant and bound to this application. Returns only the last four. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardAttempt(auth.context, id);
  if (hidden) return hidden;
  const input = await body(request, putSensitiveSchema);
  if (input instanceof NextResponse) return input;
  try {
    const saved = await saveSensitiveValue(actor, id, input.field_key, input.value);
    await demoteIfFailing(actor, id);
    return NextResponse.json(saved);
  } catch (error) {
    return failure(error);
  }
}
