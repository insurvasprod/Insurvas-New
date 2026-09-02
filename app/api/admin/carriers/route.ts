import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { createCarrierSchema } from "@/lib/carriers/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const ROLES = ["super_admin", "platform_config"] as const;
const COLUMNS = "id, code, name, is_active, sort_order, created_at, updated_at";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const includeArchived = request.nextUrl.searchParams.get("picker") !== "1";
  let query = getSupabaseServiceClient().from("carriers").select(COLUMNS).order("sort_order").order("name");
  if (!includeArchived) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Could not load carriers" }, { status: 500 });
  return NextResponse.json({ carriers: data ?? [] });
}
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const parsed = createCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid carrier" }, { status: 400 });
  const { data, error } = await getSupabaseServiceClient().from("carriers").insert(parsed.data).select(COLUMNS).single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A carrier with that code already exists" : "Could not create carrier" }, { status: error.code === "23505" ? 409 : 500 });
  await audit({ actorId: auth.session.sub, action: "carrier.created", targetType: "carrier", targetId: data.id, metadata: { code: data.code, name: data.name }, request });
  return NextResponse.json({ carrier: data }, { status: 201 });
}
