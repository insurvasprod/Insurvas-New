import { NextResponse, type NextRequest } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { updateTenantTemplateCopy } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import type { TemplateField, TemplateFormDefinition, TemplateStage } from "@/lib/templates/constants";
import { formForSave, formLogicProblem } from "@/lib/templates/logic";
import { splitFieldRules } from "@/lib/templates/fieldRulesStore";
import { clearServerDraft } from "@/lib/templates/formsServer";

/**
 * Publish: the draft becomes the form's next version. Format-2 logic (AND / OR rules, page skips) and
 * the question rules intake does not take yet travel inside form_definition (lib/templates/logic.ts,
 * fieldRulesStore.ts); both are checked here before the copy's own checks run.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { name?: string; description?: string | null; fields?: TemplateField[]; stages?: TemplateStage[]; form_definition?: TemplateFormDefinition; note?: string } | null;
  if (!body?.name || !Array.isArray(body.fields) || !Array.isArray(body.stages) || !body.form_definition || !Array.isArray(body.form_definition.sections)) return NextResponse.json({ error: "Template name, fields, stages and form are required" }, { status: 400 });
  const split = splitFieldRules(body.fields, formForSave(body.form_definition));
  const logicProblem = formLogicProblem(split.form);
  if (logicProblem) return NextResponse.json({ error: logicProblem }, { status: 400 });
  try {
    const { id } = await params;
    const template = await updateTenantTemplateCopy(auth.context.tenantId, id, { name: body.name, description: body.description ?? null, fields: split.fields, stages: body.stages, form_definition: split.form });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_definition_saved", targetType: "tenant_template", targetId: id, metadata: { fieldCount: split.fields.length, sectionCount: split.form.sections.length, format: split.form.format ?? 1, ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim().slice(0, 300) } : {}) }, request });
    // The published version is the draft now; a draft saved to Insurvas (when that is live) is done.
    await clearServerDraft(auth.context.tenantId, id).catch(() => undefined);
    return NextResponse.json({ template });
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save template" }, { status: 400 }); }
}
