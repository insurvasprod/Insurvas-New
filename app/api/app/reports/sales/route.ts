import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { loadSalesReport } from "@/lib/applications/report";
import { queryObject, salesReportQuery } from "@/lib/applications/reportSchemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.21 · Sales performance for the window and filters given. Carries premium and ESTIMATED
 * first-year commission (integer cents), so it is a money route: no assistant, no setter.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("sales_report", ["owner", "producer", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const parsed = salesReportQuery.safeParse(queryObject(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the filters and try again.", code: "invalid_request" }, { status: 400 });
  const q = parsed.data;
  try {
    const { report } = await loadSalesReport(actor.tenantId, { from: q.from, to: q.to, carrierId: q.carrier ?? null, productCode: q.product ?? null, source: q.source ?? null, producerId: q.producer ?? null });
    return NextResponse.json({ report });
  } catch (error) {
    return failure(error);
  }
}
