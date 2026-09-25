import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { consentForLeads, csvForLeads, exportAgentLeads, getAgentTemplate } from "@/lib/agentTemplates/service";
import { listPipelines } from "@/lib/pipelines/service";

// LA-2.12. The book of business is the licensed agent's — it carries premiums, quotes and
// applications, which is the exact list a setter may not see. The setter is excluded by naming the
// four roles that already had this route rather than by narrowing it to ["owner"], so this change
// adds one refusal and takes nobody's access away.
const NOT_SETTER = ["owner", "producer", "assistant", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", NOT_SETTER);
  if (auth instanceof NextResponse) return auth;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const params = request.nextUrl.searchParams;
    // Every lead of this product, posted ones included, paged past the row cap (LA-2.6-6).
    const leads = await exportAgentLeads(auth.context.tenantId, template, params.get("q")?.trim() ?? "", params.get("filter_field") ?? "", params.get("filter_value") ?? "", params.get("sort") ?? "", params.get("direction") === "desc" ? "desc" : "asc");
    const pipelines = await listPipelines(auth.context.tenantId);

    // LA-2.6 criterion 6. The certificate is the thing a regulator or a plaintiff's lawyer asks
    // for, and until now it was the one field the export left out. Fetched for the exported leads
    // only, keyed by lead, so the join happens once rather than per row.
    const consentByLead = await consentForLeads(auth.context.tenantId, leads.map((lead) => lead.id));

    const csv = csvForLeads(template.template.fields, pipelines.flatMap((pipeline) => pipeline.stages), leads, consentByLead);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${template.template.product_code}-leads.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export leads" }, { status: 500 });
  }
}
