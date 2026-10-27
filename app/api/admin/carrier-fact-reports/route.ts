import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { FactReportError, listFactReportQueue } from "@/lib/carriers/factReports";

/** Catalog › Fact reports: every agency's open carrier fact reports, then the last 100 closed. Carrier-library access. */
export async function GET() {
  const auth = await requireAdminRole(["super_admin", "platform_config"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listFactReportQueue(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FactReportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[admin carrier-fact-reports]", error);
    return NextResponse.json({ error: "The report queue could not be read. Try again." }, { status: 500 });
  }
}
