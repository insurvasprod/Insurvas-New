import { NextResponse, type NextRequest } from "next/server";

import { requireFeature } from "@/lib/entitlements/requireFeature";
import { csvForLeads, getAgentTemplate, listAgentLeads } from "@/lib/agentTemplates/service";
import { listPipelines } from "@/lib/pipelines/service";

export async function GET(request: NextRequest) {
  const auth = await requireFeature("book_of_business");
  if (auth instanceof NextResponse) return auth;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const params = request.nextUrl.searchParams;
    const leads = await listAgentLeads(auth.context.tenantId, template, params.get("q")?.trim() ?? "", params.get("filter_field") ?? "", params.get("filter_value") ?? "", params.get("sort") ?? "", params.get("direction") === "desc" ? "desc" : "asc");
    const pipelines = await listPipelines(auth.context.tenantId);
    const csv = csvForLeads(template.template.fields, pipelines.flatMap((pipeline) => pipeline.stages), leads);
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
