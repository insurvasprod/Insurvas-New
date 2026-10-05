import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { welcomePackSchema } from "@/lib/applications/afterSubmitSchemas";
import { runWelcomePack, welcomePackStatus } from "@/lib/applications/welcomePack";

const NOT_FOUND = { error: "That application could not be found." };

/** LA-3.20 · where the welcome pack went, and a 60-second signed URL for its PDF. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    return NextResponse.json({ pack: await welcomePackStatus(actor.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/** LA-3.20 · generate the PDF and (per the action and the agency's auto-send) email it — once per attempt. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const input = await body(request, welcomePackSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await runWelcomePack(actor, id, input.action));
  } catch (error) {
    return failure(error);
  }
}
