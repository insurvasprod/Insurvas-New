import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { appointmentsBatchSchema } from "@/lib/appointments/schemas";
import { saveAppointments } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = appointmentsBatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid appointment details" }, { status: 400 });
  try {
    const rows = await saveAppointments(auth.context.tenantId, parsed.data.appointments);
    await Promise.all(rows.map((row) => audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.appointment_saved", targetType: "appointment", targetId: row.id, metadata: { carrierId: row.carrier_id, state: row.state, status: row.status, effectiveFrom: row.effective_from }, request })));
    return NextResponse.json({ appointments: rows }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save appointments" }, { status: 400 });
  }
}
