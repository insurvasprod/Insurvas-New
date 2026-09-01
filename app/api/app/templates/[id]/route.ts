import { NextResponse, type NextRequest } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { updateTenantTemplateCopy } from "@/lib/agentTemplates/service";
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: string; description?: string | null; fields?: TemplateField[]; stages?: TemplateStage[]; form_definition?: TemplateFormDefinition } | null;
  if (!body?.name || !Array.isArray(body.fields) || !Array.isArray(body.stages) || !body.form_definition) return NextResponse.json({ error: "Template name, fields, stages and form are required" }, { status: 400 });
  try { const { id } = await params; const template = await updateTenantTemplateCopy(auth.context.tenantId, id, { name: body.name, description: body.description ?? null, fields: body.fields, stages: body.stages, form_definition: body.form_definition }); return NextResponse.json({ template }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save template" }, { status: 400 }); }
}
