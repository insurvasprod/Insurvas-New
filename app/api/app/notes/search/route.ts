import { NextResponse, type NextRequest } from "next/server";

import { searchLeadNotes } from "@/lib/leadNotes/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  // AG-0.5: a narrowed agency session finds notes on its producers' leads only (scope from the session).
  try { return NextResponse.json({ notes: await searchLeadNotes(auth.context.tenantId, request.nextUrl.searchParams.get("q") ?? "", await scopeFor(auth.context)) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search notes" }, { status: 400 }); }
}
