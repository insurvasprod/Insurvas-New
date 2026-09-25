import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { z } from "zod";

import { saveCarrierRequirement, saveTenantCarrier } from "@/lib/carriers/service";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
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

const requirementSchema = z.object({ carrier_id: z.string().uuid("Choose a valid carrier"), requires_eo: z.boolean() }).strict();

/**
 * Whether this carrier requires E&O cover in force — a term of the carrier's contract, counted on
 * Agency profile ("N carriers require it") and States & licences. 503 until migration
 * 20260924220100 is applied.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = requirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a carrier and whether it requires E&O" }, { status: 400 });
  try {
    const requirement = await saveCarrierRequirement(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_configured", targetType: "tenant_carrier", targetId: parsed.data.carrier_id, metadata: { carrierId: parsed.data.carrier_id, requiresEo: requirement.requires_eo }, request });
    return NextResponse.json({ requirement });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the carrier requirement" }, { status: 400 });
  }
}
