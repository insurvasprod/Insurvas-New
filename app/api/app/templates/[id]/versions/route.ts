import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listVersions } from "@/lib/templates/formsServer";

/** The Versions tab (board A9): every published version of a form, newest first, for the diff and Restore. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    return NextResponse.json({ versions: await listVersions(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the versions" }, { status: 400 });
  }
}
