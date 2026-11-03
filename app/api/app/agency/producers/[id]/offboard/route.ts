import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { offboardPreview, offboardProducer, ProducerRefusal } from "@/lib/agency/producerStore";
import { offboardSentence } from "@/lib/agency/offboardCore";
import { audit } from "@/lib/audit/log";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * AG-0.7 · offboarding. GET is the confirmation's content — the frozen balance and the policies still inside the
 * chargeback window — which the owner sees BEFORE the button. POST requires the typed confirmation word, so the
 * button cannot be pressed without the numbers having been on screen.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  try {
    const preview = await offboardPreview(auth.context.tenantId, id);
    return NextResponse.json({ ...preview, sentence: offboardSentence(preview.displayName, preview.policiesInWindow) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ProducerRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}

const confirmSchema = z.object({ confirm: z.literal("OFFBOARD", { message: "Type OFFBOARD to confirm." }) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Type OFFBOARD to confirm." }, { status: 400 });
  try {
    const result = await offboardProducer(auth.context.tenantId, id);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_offboarded", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, frozenBalanceCents: result.balanceCents, seatReleasedOn: result.seatReleasedOn }, request });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProducerRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    throw error;
  }
}
