import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { ProducerRefusal, suspendProducer } from "@/lib/agency/producerStore";
import { audit } from "@/lib/audit/log";

/** AG-0.7 · suspend: login blocked in this agency, can_submit false, book untouched, seat still in use. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  try {
    await suspendProducer(auth.context.tenantId, id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_suspended", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ProducerRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
