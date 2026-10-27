import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { FactReportError, resolveFactReport, resolveFactReportSchema } from "@/lib/carriers/factReports";

type Params = { params: Promise<{ id: string }> };

/**
 * Close one carrier fact report. Fixed with a value writes that value to the platform carrier for
 * every agency (audited as carrier.updated with before and after); declined needs a reason the
 * agency sees on its carrier card. Carrier-library access, as editing the carrier itself.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(["super_admin", "platform_config"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = resolveFactReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose fixed or declined." }, { status: 400 });
  try {
    const { report, changed } = await resolveFactReport(auth.session.sub, id, parsed.data);
    if (changed) {
      await audit({ actorId: auth.session.sub, action: "carrier.updated", targetType: "carrier", targetId: report.carrierId, metadata: { name: report.carrierName, [changed.column]: { before: changed.before, after: changed.after }, factReportId: report.id }, request });
    }
    await audit({ actorId: auth.session.sub, action: "carrier.fact_report_resolved", targetType: "carrier_fact_report", targetId: report.id, metadata: { carrierId: report.carrierId, fact: report.factKey, status: report.status, valueChanged: Boolean(changed) }, request });
    return NextResponse.json({ report, changed });
  } catch (error) {
    if (error instanceof FactReportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[admin carrier-fact-reports]", error);
    return NextResponse.json({ error: "That did not save. Try again." }, { status: 500 });
  }
}
