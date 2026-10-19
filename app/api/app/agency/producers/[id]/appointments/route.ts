import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { CarrierRefusal, setProducerAppointment } from "@/lib/agency/carrierStore";
import { producerAppointmentSchema } from "@/lib/agency/schemas";
import { audit } from "@/lib/audit/log";

/** AG-0.9 · a producer's appointment for one carrier in one state (read with the Carriers tab). Owner and admin. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const parsed = producerAppointmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the appointment" }, { status: 400 });
  try {
    await setProducerAppointment({ tenantId: auth.context.tenantId, producerId: id, carrierId: parsed.data.carrierId, state: parsed.data.state, status: parsed.data.status, effectiveFrom: parsed.data.effectiveFrom ?? null, expiresOn: parsed.data.expiresOn ?? null, actorId: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_carrier_set", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, appointment: parsed.data }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CarrierRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
