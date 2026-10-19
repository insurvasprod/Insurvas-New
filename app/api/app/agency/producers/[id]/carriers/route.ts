import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardProducer } from "@/lib/agency/guards";
import { CarrierRefusal, readProducerCarriers, setProducerCarrier } from "@/lib/agency/carrierStore";
import { producerCarrierSchema } from "@/lib/agency/schemas";
import { percentToBps } from "@/lib/agency/constants";
import { audit } from "@/lib/audit/log";

const NO_STORE = { "Cache-Control": "no-store" };

/** AG-0.9 / AG-1.1 Carriers tab · his level and the agency's, his writing number, his appointments, with dates. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  return NextResponse.json(await readProducerCarriers(auth.context.tenantId, id), { headers: NO_STORE });
}

/** AG-0.9 · set a level and/or a writing number from a date. Owner and admin only. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const parsed = producerCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the level and writing number" }, { status: 400 });
  const levelBps = parsed.data.levelPercent ? percentToBps(parsed.data.levelPercent) : null;
  if (parsed.data.levelPercent && levelBps === null) return NextResponse.json({ error: "Enter the level as a percentage, like 90 or 85.5" }, { status: 400 });
  try {
    await setProducerCarrier({ tenantId: auth.context.tenantId, producerId: id, carrierId: parsed.data.carrierId, levelBps, writingNumber: parsed.data.writingNumber ?? null, effectiveFrom: parsed.data.effectiveFrom, actorId: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_carrier_set", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, carrierId: parsed.data.carrierId, levelBps, writingNumber: parsed.data.writingNumber ?? null, effectiveFrom: parsed.data.effectiveFrom }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CarrierRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
