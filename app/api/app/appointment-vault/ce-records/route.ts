import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { ceSchema } from "@/lib/appointments/schemas";
import { saveCeRecord } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = ceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid CE details" }, { status: 400 });
  try {
    const row = await saveCeRecord(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.ce_record_saved", targetType: "ce_record", targetId: row.id, metadata: { state: row.state, deadline: row.deadline }, request });
    return NextResponse.json({ ceRecord: row }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save CE record" }, { status: 400 }); }
}
