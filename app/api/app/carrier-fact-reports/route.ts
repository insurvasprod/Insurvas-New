import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { FactReportError, createFactReport, createFactReportSchema, listTenantFactReports } from "@/lib/carriers/factReports";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Settings › Carriers › "Something wrong? Tell us" (migration 20261027200000). GET: the agency's own
 * reports, so the carrier card can say a fact is being checked and how a closed report ended. POST:
 * report one wrong carrier fact to Insurvas. Owners, as the rest of Settings › Carriers.
 */
function failure(error: unknown) {
  if (error instanceof FactReportError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[carrier-fact-reports]", error);
  return NextResponse.json({ error: "That did not save. Try again." }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("appointment_vault", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listTenantFactReports(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = createFactReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Say which fact is wrong and what it should be." }, { status: 400 });
  try {
    const report = await createFactReport(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "carrier.fact_reported", targetType: "carrier_fact_report", targetId: report.id, metadata: { carrierId: report.carrierId, fact: report.factKey }, request });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
