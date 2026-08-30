import { NextResponse, type NextRequest } from "next/server";

import { requireFeature } from "@/lib/entitlements/requireFeature";
import { createAgentLead, getAgentTemplate, listAgentLeads } from "@/lib/agentTemplates/service";

export async function GET(request: NextRequest) {
  const auth = await requireFeature("book_of_business");
  if (auth instanceof NextResponse) return auth;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const params = request.nextUrl.searchParams;
    const direction = params.get("direction") === "desc" ? "desc" : "asc";
    const leads = await listAgentLeads(
      auth.context.tenantId,
      template,
      params.get("q")?.trim() ?? "",
      params.get("filter_field") ?? "",
      params.get("filter_value") ?? "",
      params.get("sort") ?? "",
      direction,
    );
    return NextResponse.json({ template, leads, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load leads" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeature("book_of_business", { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { values?: unknown; stage_key?: string } | null;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const lead = await createAgentLead(auth.context.tenantId, auth.context.userId, template, body?.values, body?.stage_key);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create lead" }, { status: 400 });
  }
}
