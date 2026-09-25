import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { saveCommissionSchedule } from "@/lib/carriers/service";
import { commissionScheduleSchema } from "@/lib/carriers/schemas";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = commissionScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid commission schedule details" }, { status: 400 });
  try {
    const row = await saveCommissionSchedule(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.commission_schedule_saved", targetType: "commission_schedule", targetId: row.id, metadata: { carrierId: row.carrier_id, productCode: row.product_code, policyYear: row.policy_year, appliesOnward: row.applies_onward === true, effectiveFrom: row.effective_from }, request });
    return NextResponse.json({ commissionSchedule: row }, { status: 201 });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save commission schedule" }, { status: 400 });
  }
}
