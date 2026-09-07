import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { deleteFormDraft, getAgentTemplate, loadFormDraft, saveFormDraft } from "@/lib/agentTemplates/service";
import { requireFeature } from "@/lib/entitlements/requireFeature";

export async function GET() {
  const auth = await requireFeature("book_of_business");
  if (auth instanceof NextResponse) return auth;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const draft = await loadFormDraft(auth.context.tenantId, auth.context.userId, template.template.product_code);
    return NextResponse.json({ draft, definition_version: template.assignment.definition_version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load draft" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFeature("book_of_business", { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { payload?: unknown } | null;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const id = await saveFormDraft(auth.context.tenantId, auth.context.userId, template.template.product_code, { tenant_template_id: template.tenant_template_id, definition_version: template.assignment.definition_version }, body?.payload, null);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_draft_saved", targetType: "form_draft", targetId: id, metadata: { productCode: template.template.product_code, definitionVersion: template.assignment.definition_version }, request });
    return NextResponse.json({ id, definition_version: template.assignment.definition_version });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save draft" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeature("book_of_business", { write: true });
  if (auth instanceof NextResponse) return auth;
  try { const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId); await deleteFormDraft(auth.context.tenantId, auth.context.userId, template.template.product_code); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_draft_cleared", targetType: "form_draft", metadata: { productCode: template.template.product_code }, request }); return NextResponse.json({ cleared: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear draft" }, { status: 400 }); }
}
