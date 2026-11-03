import { after, NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { refreshDiscrepanciesQuietly } from "@/lib/discrepancies/service";
import { z } from "zod";

import { saveCarrierRequirement, saveTenantCarrier } from "@/lib/carriers/service";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { CarrierLimitError } from "@/lib/carriers/limit";
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
    // What the contract expects changed, so what the carrier owes did too (LA-4.5 option a). After the response.
    const tenantId = auth.context.tenantId;
    after(() => refreshDiscrepanciesQuietly(tenantId));
    return NextResponse.json({ tenantCarrier: row }, { status: 201 });
  } catch (error) {
    if (error instanceof CarrierLimitError) return NextResponse.json({ error: error.message, code: error.code, limit: error.limit }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save carrier contract" }, { status: 400 });
  }
}

const requirementSchema = z
  .object({ carrier_id: z.string().uuid("Choose a valid carrier"), contracted: z.boolean({ message: "Say whether you still write with this carrier" }) })
  .strict();

/**
 * LA-0.4's switch, `contracted`: false takes the carrier out of quoting, assignment and every
 * "who do we write with" list; the contract history and money on existing policies stay. 503 until
 * migrations 20260924220100 and 20261013100000 are applied.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = requirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a carrier and whether you still write with it" }, { status: 400 });
  try {
    const requirement = await saveCarrierRequirement(auth.context.tenantId, auth.context.userId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.carrier_configured", targetType: "tenant_carrier", targetId: parsed.data.carrier_id, metadata: { carrierId: parsed.data.carrier_id, contracted: requirement.contracted }, request });
    return NextResponse.json({ requirement });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the carrier requirement" }, { status: 400 });
  }
}
