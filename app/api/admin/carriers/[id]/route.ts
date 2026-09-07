import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { updateCarrierSchema } from "@/lib/carriers/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const ROLES = ["super_admin", "platform_config"] as const;
const COLUMNS = "id, code, name, is_active, sort_order, created_at, updated_at";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid carrier" }, { status: 400 });
  const { data, error } = await getSupabaseServiceClient().from("carriers").update(parsed.data).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update carrier" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  await audit({ actorId: auth.session.sub, action: data.is_active ? "carrier.updated" : "carrier.archived", targetType: "carrier", targetId: id, metadata: { changes: parsed.data }, request });
  return NextResponse.json({ carrier: data });
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const { data, error } = await getSupabaseServiceClient().from("carriers").update({ is_active: false }).eq("id", id).select(COLUMNS).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not archive carrier" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  await audit({ actorId: auth.session.sub, action: "carrier.archived", targetType: "carrier", targetId: id, request });
  return NextResponse.json({ carrier: data, archived: true });
}
