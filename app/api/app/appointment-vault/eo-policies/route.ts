import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { eoPolicySchema } from "@/lib/appointments/schemas";
import { saveEoPolicy } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = eoPolicySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid E&O details" }, { status: 400 });
  try {
    const row = await saveEoPolicy(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.eo_policy_saved", targetType: "eo_policy", targetId: row.id, metadata: { carrier: row.carrier, policyNumber: row.policy_number, expiresAt: row.expires_at, coverageAmountCents: row.coverage_amount_cents }, request });
    return NextResponse.json({ eoPolicy: row }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save E&O policy" }, { status: 400 }); }
}
