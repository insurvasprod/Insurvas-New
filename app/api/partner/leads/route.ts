import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { createPartnerLead, deleteFormDraft, getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";

export async function POST(request: NextRequest) {
  const auth = await requirePartner(); if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { product_code?: unknown; values?: unknown } | null;
  if (typeof body?.product_code !== "string" || !/^[a-z][a-z0-9_]{1,59}$/.test(body.product_code)) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  try {
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, body.product_code);
    const template = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code);
    const lead = await createPartnerLead(auth.context.tenantId, auth.context.partnerId, auth.context.userId, template, body.values);
    await deleteFormDraft(auth.context.tenantId, auth.context.userId, body.product_code, auth.context.partnerId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lead_submitted", targetType: "agent_lead", targetId: lead.id, metadata: { partnerId: auth.context.partnerId, productCode: body.product_code, definitionVersion: template.assignment.definition_version }, request });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not submit lead" }, { status: 400 }); }
}
