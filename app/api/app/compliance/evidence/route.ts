import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { buildEvidenceReport, EvidenceError, mayGenerateReports, type EvidenceOutput, type EvidenceScope } from "@/lib/compliance/evidenceReport";
import { buildEvidencePdf, evidenceCsv } from "@/lib/compliance/evidencePdf";
import { evidenceRange } from "@/lib/compliance/evidenceRange";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * LA-6.3 (Notion sprint) · the compliance evidence report for one number, lead or client: on screen
 * (JSON), as a PDF for counsel, or the timeline as CSV. Owner and producer only — never setters,
 * assistants (buffer agents), bookkeepers or partner users. Every generation is logged.
 */
const ROLES = ["owner", "producer"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("litigation_packet", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "The compliance evidence report");
  if (refused) return refused;
  const p = request.nextUrl.searchParams;
  const phone = p.get("phone");
  const lead = p.get("lead");
  const contact = p.get("contact");
  const scope: EvidenceScope | null = phone ? { type: "phone", phone } : lead ? { type: "lead", leadId: lead } : contact ? { type: "contact", contactId: contact } : null;
  if (!scope) return NextResponse.json({ error: "Enter a phone number, or open the report from a lead or a client." }, { status: 400 });
  const range = evidenceRange(p.get("from"), p.get("to"));
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const format = (p.get("format") ?? "json").toLowerCase();
  const output: EvidenceOutput = format === "pdf" ? "pdf" : format === "csv" ? "csv" : "screen";
  const { tenantId, userId, role } = auth.context;
  if (!(await mayGenerateReports(tenantId, role))) return NextResponse.json({ error: "Your agency has not allowed your role to generate compliance reports." }, { status: 403 });
  try {
    const report = await buildEvidenceReport({ tenantId, userId, role }, scope, range, output);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.evidence_report", targetType: scope.type, targetId: scope.type === "phone" ? report.phones[0] ?? "phone" : scope.type === "lead" ? scope.leadId : scope.contactId, metadata: { tenantId, output, gaps: report.gaps.length, records: report.timeline.length }, request });
    const name = `evidence-${report.phones[0] ?? "report"}-${report.generatedAt.slice(0, 10)}`;
    if (output === "pdf") {
      const bytes = await buildEvidencePdf(report);
      return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store" } });
    }
    if (output === "csv") {
      return new NextResponse(evidenceCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
    }
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EvidenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[evidence-report]", error);
    return NextResponse.json({ error: "The report could not be generated" }, { status: 500 });
  }
}
