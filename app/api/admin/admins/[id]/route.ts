import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { updateAdminSchema } from "@/lib/adminAuth/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  if (id === auth.session.sub) {
    return NextResponse.json({ error: "You cannot change your own role or active status" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: updated, error } = await supabase
    .from("admin_users")
    .update(parsed.data)
    .eq("id", id)
    .select("id, email, name, role, is_active, created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not update admin" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "admin.updated",
    targetType: "admin_user",
    targetId: id,
    metadata: { changes: parsed.data },
    request,
  });

  return NextResponse.json({ admin: updated });
}
