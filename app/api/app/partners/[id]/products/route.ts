import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { partnerProductActionSchema } from "@/lib/partnerProducts/schemas";
import { listPartnerProductConfiguration, setPartnerProductApproval } from "@/lib/partnerProducts/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    return NextResponse.json({ products: await listPartnerProductConfiguration(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load partner products";
    return NextResponse.json({ error: message === "partner_not_found" ? "Partner not found" : "Could not load partner products" }, { status: message === "partner_not_found" ? 404 : 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = partnerProductActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid product approval" }, { status: 400 });
  try {
    await setPartnerProductApproval(auth.context.tenantId, id, parsed.data.product_code, parsed.data.approved, auth.context.userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: parsed.data.approved ? "tenant.partner_product_approved" : "tenant.partner_product_revoked", targetType: "partner_product", targetId: `${id}:${parsed.data.product_code}`, metadata: { partnerId: id, productCode: parsed.data.product_code, approved: parsed.data.approved }, request });
    return NextResponse.json({ products: await listPartnerProductConfiguration(auth.context.tenantId, id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save partner approval";
    const known = new Map([["partner_not_found", "Partner not found"], ["partner_offboarded", "Offboarded partners cannot receive product approvals"], ["product_not_found", "That product is not in the catalog"], ["product_archived", "Archived products cannot be approved"], ["product_not_enabled", "Enable this product for your business before approving it for a partner"]]);
    const status = message === "partner_not_found" || message === "product_not_found" ? 404 : known.has(message) ? 409 : 400;
    return NextResponse.json({ error: known.get(message) ?? "Could not save partner approval" }, { status });
  }
}
