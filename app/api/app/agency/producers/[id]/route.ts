import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardProducer } from "@/lib/agency/guards";
import { producerProfileUpdateSchema } from "@/lib/agency/schemas";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

/**
 * AG-1.1 · one producer's record (Overview). can_submit is shown, never editable here — it is derived (AG-1.10).
 * A producer opens his own; a manager his reports'; owner, admin and bookkeeper anyone's.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner", "bookkeeper", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  const { data: p, error } = await db()
    .from("producer")
    .select("id, user_id, display_name, npn, status, hired_on, offboarded_on, can_submit, can_submit_reason, frozen_balance_cents, reactivatable_until, seat_released_on, users!producer_user_id_fkey(email, phone)")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !p) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const [membership, hierarchy] = await Promise.all([
    db().from("tenant_users").select("role, agency_role").eq("tenant_id", auth.context.tenantId).eq("user_id", p.user_id).maybeSingle(),
    db().from("producer_hierarchy").select("parent_producer_id, effective_from, effective_to").eq("tenant_id", auth.context.tenantId).eq("producer_id", id).lte("effective_from", today),
  ]);
  const current = ((hierarchy.data ?? []) as Array<{ parent_producer_id: string | null; effective_from: string; effective_to: string | null }>).find((h) => !h.effective_to || today <= h.effective_to);
  let managerName = "Owner";
  if (current?.parent_producer_id) {
    const { data: m } = await db().from("producer").select("display_name").eq("id", current.parent_producer_id).maybeSingle();
    managerName = m?.display_name ?? "Manager";
  }
  return NextResponse.json({
    id: p.id,
    userId: p.user_id,
    displayName: p.display_name,
    npn: p.npn,
    status: p.status,
    hiredOn: p.hired_on,
    offboardedOn: p.offboarded_on,
    canSubmit: p.can_submit,
    canSubmitReason: p.can_submit_reason,
    frozenBalanceCents: p.frozen_balance_cents == null ? null : Number(p.frozen_balance_cents),
    reactivatableUntil: p.reactivatable_until,
    seatReleasedOn: p.seat_released_on,
    email: p.users?.email ?? null,
    phone: p.users?.phone ?? null,
    role: membership.data?.agency_role ?? membership.data?.role ?? null,
    managerProducerId: current?.parent_producer_id ?? null,
    managerName,
    isSelf: p.user_id === auth.context.userId,
  }, { headers: NO_STORE });
}

/** The ordinary profile update: name, NPN, hire date. `.strict()` refuses can_submit and anything else (AG-0.1). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That producer could not be found." }, { status: 404 });
  const parsed = producerProfileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Only the name, NPN and hire date can be changed here." }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.displayName !== undefined) patch.display_name = parsed.data.displayName;
  if (parsed.data.npn !== undefined) patch.npn = parsed.data.npn;
  if (parsed.data.hiredOn !== undefined) patch.hired_on = parsed.data.hiredOn;
  const { error } = await db().from("producer").update(patch).eq("tenant_id", auth.context.tenantId).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not save the producer" }, { status: 500 });
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.producer_carrier_set", targetType: "producer", targetId: id, metadata: { tenantId: auth.context.tenantId, profile: parsed.data }, request });
  return NextResponse.json({ ok: true });
}
