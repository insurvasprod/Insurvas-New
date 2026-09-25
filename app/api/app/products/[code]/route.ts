import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { productCodeSchema, tenantProductActionSchema } from "@/lib/partnerProducts/schemas";
import { setTenantProduct } from "@/lib/partnerProducts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireFeatureRole("publisher_records", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { code: rawCode } = await params;
  const code = productCodeSchema.safeParse(rawCode);
  if (!code.success) return NextResponse.json({ error: "Choose a valid product" }, { status: 400 });
  const parsed = tenantProductActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose whether the product is enabled" }, { status: 400 });
  try {
    const product = await setTenantProduct(auth.context.tenantId, code.data, parsed.data.is_enabled);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: parsed.data.is_enabled ? "tenant.product_enabled" : "tenant.product_disabled", targetType: "tenant_product", targetId: `${auth.context.tenantId}:${code.data}`, metadata: { tenantId: auth.context.tenantId, productCode: code.data, isEnabled: parsed.data.is_enabled }, request });
    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save product setting";
    const status = message === "product_not_found" || message === "product_archived" ? 404 : 400;
    return NextResponse.json({ error: status === 404 ? "That product is not available in the catalog" : message }, { status });
  }
}
