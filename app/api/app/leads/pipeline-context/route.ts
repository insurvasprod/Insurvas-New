import { NextResponse, type NextRequest } from "next/server";

import { dispositionLibrary, pipelineViewContext } from "@/lib/pipelines/views";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * What the pipeline views need besides the leads: each stage's rules, the dispositions that land on
 * each stage (the only way a lead enters one from these screens), the outcomes with no stage, draft
 * pipelines and how many leads' stages disagree between their two rows. Same roles as the leads.
 *
 * `?library=1` answers with the disposition library instead — every outcome, retired included, with
 * where it lands and how much it is used. Owners only: it is the screen they configure from.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try {
    if (request.nextUrl.searchParams.get("library") === "1") {
      if (auth.context.role !== "owner") return NextResponse.json({ error: "Only an owner can open the disposition library." }, { status: 403 });
      return NextResponse.json({ library: await dispositionLibrary(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await pipelineViewContext(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the pipeline context" }, { status: 500 });
  }
}
