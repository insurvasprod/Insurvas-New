import { NextResponse } from "next/server";

import { getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";

export async function GET(_request: Request, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const productCode = (await params).productCode;
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, productCode);
    const template = await getTenantTemplateForProduct(auth.context.tenantId, productCode);
    return NextResponse.json({ template }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partner form" }, { status: 404 }); }
}
