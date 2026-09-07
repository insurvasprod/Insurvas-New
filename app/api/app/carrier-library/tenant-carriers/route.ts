import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { saveTenantCarrier } from "@/lib/carriers/service";
import { tenantCarrierSchema } from "@/lib/carriers/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = tenantCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid carrier contract details" }, { status: 400 });
  try {
    const row = await saveTenantCarrier(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_configured", targetType: "tenant_carrier", targetId: row.id, metadata: { carrierId: row.carrier_id, contractLevelBp: row.contract_level_bp, effectiveFrom: row.effective_from }, request });
    return NextResponse.json({ tenantCarrier: row }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save carrier contract" }, { status: 400 });
  }
}
