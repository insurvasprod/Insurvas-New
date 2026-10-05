import { NextResponse } from "next/server";

import { body, failure, isUuid } from "@/lib/applications/http";
import { actorOf, NO_STORE } from "@/lib/extension/http";
import { copyTickSchema } from "@/lib/extension/schemas";
import { listTicks, putTicks } from "@/lib/extension/ticks";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.14 · copy-assist ticks, shared between the inline panel and the pop-out window (and the
 * extension, through its own bearer route). `{ field_key }`, or `{ field_keys }` for "Copy all".
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ ticks: await listTicks(actorOf(auth, request).tenantId, id) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  const input = await body(request, copyTickSchema);
  if (input instanceof NextResponse) return input;
  try {
    const actor = actorOf(auth, request);
    const keys = input.field_keys ?? (input.field_key ? [input.field_key] : []);
    return NextResponse.json(await putTicks(actor.tenantId, actor.userId, id, keys, input.surface));
  } catch (error) {
    return failure(error);
  }
}
