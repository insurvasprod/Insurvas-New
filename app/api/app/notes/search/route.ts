import { NextResponse, type NextRequest } from "next/server";

import { searchLeadNotes } from "@/lib/leadNotes/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ notes: await searchLeadNotes(auth.context.tenantId, request.nextUrl.searchParams.get("q") ?? "") }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search notes" }, { status: 400 }); }
}
