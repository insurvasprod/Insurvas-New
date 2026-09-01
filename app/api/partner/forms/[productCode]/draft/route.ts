import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { getTenantTemplateForProduct, loadFormDraft, saveFormDraft } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";

export async function GET(_request: Request, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner(); if (auth instanceof NextResponse) return auth;
  try { const productCode = (await params).productCode; await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, productCode); const draft = await loadFormDraft(auth.context.tenantId, auth.context.userId, productCode, auth.context.partnerId); return NextResponse.json({ draft }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load draft" }, { status: 404 }); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner(); if (auth instanceof NextResponse) return auth;
  if (auth.context.partnerStatus !== "active") return NextResponse.json({ error: "This partner is paused and cannot save new lead drafts" }, { status: 403 });
  try { const productCode = (await params).productCode; await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, productCode); const template = await getTenantTemplateForProduct(auth.context.tenantId, productCode); const body = await request.json().catch(() => null) as { payload?: unknown } | null; const id = await saveFormDraft(auth.context.tenantId, auth.context.userId, productCode, { tenant_template_id: template.tenant_template_id, definition_version: template.assignment.definition_version }, body?.payload, auth.context.partnerId); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.form_draft_saved", targetType: "form_draft", targetId: id, metadata: { partnerId: auth.context.partnerId, productCode, definitionVersion: template.assignment.definition_version }, request }); return NextResponse.json({ id }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save draft" }, { status: 400 }); }
}
