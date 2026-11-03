import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { leadStageHistory } from "@/lib/pipelines/views";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardLead } from "@/lib/agency/guards";

/** A lead's stage changes, newest first: from where, to where, by which disposition and whom. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, (await params).id);
  if (hidden) return hidden;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });
  try {
    return NextResponse.json({ events: await leadStageHistory(auth.context.tenantId, id.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the stage history" }, { status: 500 });
  }
}
