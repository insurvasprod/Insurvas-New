import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getLeadRecord } from "@/lib/leadWorkspace/record";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The lead's record tabs — Attempts, Callbacks and Nurture — read when a tab opens. Read-only, and
 * the same gate as the lead itself (`leads/[id]`): whoever can open the lead can read its record.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  try {
    return NextResponse.json(await getLeadRecord(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load this lead's record";
    return NextResponse.json({ error: message }, { status: message === "Lead not found" ? 404 : 500 });
  }
}
