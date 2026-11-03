import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardProducer } from "@/lib/agency/guards";
import { audit } from "@/lib/audit/log";

/**
 * AG-0.4 · who works for a producer: the assistants (see what he sees, never money) and, in an agency, the setters
 * who book onto his calendar (owner decision 2026-10-19). Both live in assistant_producer; agency_visible_user_ids
 * reads it. The owner or an admin assigns; everyone else gets no route at all. A producer outside the session's
 * scope is a 404, as every AG-0.5 guard answers.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
const SUPPORT_ROLES = ["assistant", "setter"] as const;
const NOT_FOUND = NextResponse.json({ error: "That producer could not be found." }, { status: 404 });

async function producerUser(tenantId: string, producerId: string): Promise<string | null> {
  const { data } = await db().from("producer").select("user_id").eq("tenant_id", tenantId).eq("id", producerId).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NOT_FOUND;
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  const userId = await producerUser(auth.context.tenantId, id);
  if (!userId) return NOT_FOUND;
  const [assigned, members] = await Promise.all([
    db().from("assistant_producer").select("assistant_user_id").eq("tenant_id", auth.context.tenantId).eq("producer_user_id", userId),
    db().from("tenant_users").select("user_id, role, accepted_at, users!inner(name, email)").eq("tenant_id", auth.context.tenantId).in("role", [...SUPPORT_ROLES]),
  ]);
  if (assigned.error || members.error) return NextResponse.json({ error: "Could not load who works for this producer" }, { status: 500 });
  const assignedIds = new Set(((assigned.data ?? []) as Array<{ assistant_user_id: string }>).map((r) => r.assistant_user_id));
  const people = ((members.data ?? []) as Array<{ user_id: string; role: string; accepted_at: string | null; users: { name: string | null; email: string | null } }>).map((m) => ({
    userId: m.user_id,
    role: m.role as (typeof SUPPORT_ROLES)[number],
    name: m.users?.name?.trim() || m.users?.email || "Member",
    invited: !m.accepted_at,
    assigned: assignedIds.has(m.user_id),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ people }, { headers: { "Cache-Control": "no-store" } });
}

const bodySchema = z.object({ userId: z.string().uuid() }).strict();

async function change(request: NextRequest, params: Promise<{ id: string }>, assign: boolean) {
  const auth = await requireFeatureRole("team_hierarchy", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NOT_FOUND;
  const hidden = await guardProducer(auth.context, id);
  if (hidden) return hidden;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an assistant or setter" }, { status: 400 });
  const producerUserId = await producerUser(auth.context.tenantId, id);
  if (!producerUserId) return NOT_FOUND;
  const { data: member } = await db().from("tenant_users").select("role").eq("tenant_id", auth.context.tenantId).eq("user_id", parsed.data.userId).maybeSingle();
  if (!member || !SUPPORT_ROLES.includes(member.role)) {
    return NextResponse.json({ error: "Only an assistant or a setter can work for a producer.", code: "not_support_role" }, { status: 409 });
  }
  const write = assign
    ? db().from("assistant_producer").upsert({ tenant_id: auth.context.tenantId, assistant_user_id: parsed.data.userId, producer_user_id: producerUserId, created_by: auth.context.userId }, { onConflict: "tenant_id,assistant_user_id,producer_user_id", ignoreDuplicates: true })
    : db().from("assistant_producer").delete().eq("tenant_id", auth.context.tenantId).eq("assistant_user_id", parsed.data.userId).eq("producer_user_id", producerUserId);
  const { error } = await write;
  if (error) return NextResponse.json({ error: assign ? "Could not assign them" : "Could not remove them" }, { status: 500 });
  await audit({
    actorType: "tenant",
    actorId: auth.context.userId,
    action: assign ? "agency.support_assigned" : "agency.support_removed",
    targetType: "producer",
    targetId: id,
    metadata: { tenantId: auth.context.tenantId, supportUserId: parsed.data.userId, supportRole: member.role },
    request,
  });
  return NextResponse.json({ ok: true });
}

export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return change(request, params, true);
}

export function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return change(request, params, false);
}
