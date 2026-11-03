import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { updateAdminSchema } from "@/lib/adminAuth/schemas";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { LAST_SUPER_ADMIN_REFUSAL, SELF_REFUSAL, removesActiveSuperAdmin, staffChangeRefusal } from "@/lib/adminStaff/present";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type TargetRow = { id: string; email: string; role: AdminRole; is_active: boolean };

/** The trigger in 20260924353000 refuses with this prefix; the route's own check usually gets there first. */
const LAST_SUPER_ADMIN_ERROR = "last_active_super_admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(["super_admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  if (id === auth.session.sub) {
    return NextResponse.json({ error: SELF_REFUSAL }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: target, error: readError } = await supabase
    .from("admin_users")
    .select("id, email, role, is_active")
    .eq("id", id)
    .maybeSingle<TargetRow>();

  if (readError) {
    return NextResponse.json({ error: "Could not update admin" }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  }

  // Only what actually changes, so the audit row says what happened rather than what was sent.
  const changes: { role?: AdminRole; is_active?: boolean } = {};
  if (parsed.data.role !== undefined && parsed.data.role !== target.role) changes.role = parsed.data.role;
  if (parsed.data.is_active !== undefined && parsed.data.is_active !== target.is_active) changes.is_active = parsed.data.is_active;
  if (changes.role === undefined && changes.is_active === undefined) {
    return NextResponse.json({ error: "Nothing to change: the account is already like that." }, { status: 400 });
  }

  // The last-active-super-admin rule, checked here so it holds before the migration is applied.
  // Two super admins acting at the same moment can both pass this read; the trigger cannot be passed.
  if (removesActiveSuperAdmin(target, changes)) {
    const { count, error: countError } = await supabase
      .from("admin_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("is_active", true);
    if (countError) {
      return NextResponse.json({ error: "Could not update admin" }, { status: 500 });
    }
    const refusal = staffChangeRefusal({ actorId: auth.session.sub, target, change: changes, activeSuperAdmins: count ?? 0 });
    if (refusal) {
      return NextResponse.json({ error: refusal, code: LAST_SUPER_ADMIN_ERROR }, { status: 409 });
    }
  }

  const { data: updated, error } = await supabase
    .from("admin_users")
    .update(changes)
    .eq("id", id)
    .select("id, email, name, role, is_active, created_at")
    .maybeSingle();

  if (error) {
    if (error.message?.includes(LAST_SUPER_ADMIN_ERROR)) {
      return NextResponse.json({ error: LAST_SUPER_ADMIN_REFUSAL, code: LAST_SUPER_ADMIN_ERROR }, { status: 409 });
    }
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
    metadata: {
      email: target.email,
      changes,
      before: { role: target.role, is_active: target.is_active },
    },
    request,
  });

  return NextResponse.json({ admin: updated });
}
