import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { leadStageHistory } from "@/lib/pipelines/views";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** A lead's stage changes, newest first: from where, to where, by which disposition and whom. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  try {
    return NextResponse.json({ events: await leadStageHistory(auth.context.tenantId, id.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the stage history" }, { status: 500 });
  }
}
