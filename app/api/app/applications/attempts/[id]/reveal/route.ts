import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { revealField } from "@/lib/applications/mutations";
import { revealSchema } from "@/lib/applications/schemas";

/**
 * LA-3.7 · reveal ONE sensitive value. Owner and producer only (decision 5 — the menu is a
 * convenience, the API is the boundary). The access record is written before the value leaves; a
 * reveal that cannot be recorded does not happen. Never cached.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, revealSchema);
  if (input instanceof NextResponse) return input;
  try {
    const revealed = await revealField(actor, id, input.field_key, input.surface);
    return NextResponse.json(revealed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
