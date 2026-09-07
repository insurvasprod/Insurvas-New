import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { saveAdvanceRule } from "@/lib/carriers/service";
import { advanceRuleSchema } from "@/lib/carriers/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = advanceRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid advance rule details" }, { status: 400 });
  try {
    const row = await saveAdvanceRule(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.advance_rule_saved", targetType: "advance_rule", targetId: row.id, metadata: { carrierId: row.carrier_id, productCode: row.product_code, effectiveFrom: row.effective_from }, request });
    return NextResponse.json({ advanceRule: row }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save advance rule" }, { status: 400 });
  }
}
