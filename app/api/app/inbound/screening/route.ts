import { NextResponse } from "next/server";
import { z } from "zod";

import { screeningForWorkItem } from "@/lib/transferInbox/inboxExtras";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** One transfer's screening ladder, for the inbox drawer. Read-only. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("work_item_id"));
  if (!id.success) return NextResponse.json({ error: "Choose a transfer" }, { status: 400 });
  const ladder = await screeningForWorkItem(auth.context.tenantId, id.data).catch(() => null);
  if (!ladder) return NextResponse.json({ error: "That transfer's screening could not be read" }, { status: 404 });
  return NextResponse.json(ladder, { headers: { "Cache-Control": "no-store" } });
}
