import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { moveProducerSchema } from "@/lib/agency/schemas";
import { audit } from "@/lib/audit/log";

/**
 * AG-0.3 / AG-1.2 · reassign a producer's manager from a date. Writes a new effective-dated hierarchy row and
 * closes the old one — the parent of an existing row is never updated. Cycles are refused by the database.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const parsed = moveProducerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a manager and a date" }, { status: 400 });
  const { error } = await getSupabaseServiceClient().rpc("move_producer_to_manager" as never, {
    p_tenant_id: auth.context.tenantId,
    p_producer_id: id,
    p_parent_producer_id: parsed.data.managerProducerId,
    p_effective_from: parsed.data.effectiveFrom,
    p_actor: auth.context.userId,
  } as never);
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (/hierarchy_cycle/.test(message)) return NextResponse.json({ error: "That would make the producer report to someone who reports to him.", code: "hierarchy_cycle" }, { status: 409 });
    if (/hierarchy_same_day/.test(message)) return NextResponse.json({ error: "This producer already moved on that day. Pick the next day.", code: "same_day" }, { status: 409 });
    if (/manager_not_found|producer_not_found/.test(message)) return NextResponse.json({ error: "That producer or manager could not be found.", code: "not_found" }, { status: 404 });
    return NextResponse.json({ error: "Could not change the manager" }, { status: 500 });
  }
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_manager_changed", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, managerProducerId: parsed.data.managerProducerId, effectiveFrom: parsed.data.effectiveFrom }, request });
  return NextResponse.json({ ok: true });
}
