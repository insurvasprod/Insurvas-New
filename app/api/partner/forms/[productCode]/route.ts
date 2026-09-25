import { NextResponse } from "next/server";

import { getPartnerTemplateForProduct } from "@/lib/agentTemplates/service";
import { partnerProductHttpError } from "@/lib/partnerProducts/http";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { assertPartnerProductApproved } from "@/lib/partnerProducts/service";

export async function GET(_request: Request, { params }: { params: Promise<{ productCode: string }> }) {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  try {
    const productCode = (await params).productCode;
    await assertPartnerProductApproved(auth.context.tenantId, auth.context.partnerId, productCode);
    const template = await getPartnerTemplateForProduct(auth.context.tenantId, auth.context.partnerId, auth.context.userId, productCode);
    return NextResponse.json({ template }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = partnerProductHttpError(error, "Could not load partner form");
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
