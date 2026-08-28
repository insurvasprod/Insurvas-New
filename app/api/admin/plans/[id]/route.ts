import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { updatePlanSchema } from "@/lib/plans/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { code, name, description, is_public, is_archived, sort_order } = parsed.data;
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("admin_update_plan", {
    p_plan_id: id,
    p_code: code,
    p_name: name,
    p_description: description || null,
    p_is_public: is_public,
    p_is_archived: is_archived,
    p_sort_order: sort_order,
  });

  if (error) {
    if (error.message?.includes("code_locked")) {
      return NextResponse.json(
        { error: "This plan has subscribers, so its code can no longer be changed" },
        { status: 409 },
      );
    }
    if (error.message?.includes("plan_not_found")) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "A plan with that code already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update the plan" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (result.old_code !== result.new_code) changes.code = { from: result.old_code, to: result.new_code };
  if (result.old_name !== result.new_name) changes.name = { from: result.old_name, to: result.new_name };
  if (result.old_is_archived !== result.new_is_archived) {
    changes.is_archived = { from: result.old_is_archived, to: result.new_is_archived };
  }

  if (Object.keys(changes).length > 0) {
    await audit({
      actorId: auth.session.sub,
      action: "plan.updated",
      targetType: "plan",
      targetId: id,
      metadata: { changes },
      request,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = getSupabaseServiceClient();

  const { data: plan } = await supabase
    .from("plans")
    .select("id, code, version, name")
    .eq("id", id)
    .maybeSingle<{ id: string; code: string; version: number; name: string }>();

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const { error } = await supabase.from("plans").delete().eq("id", id);

  if (error) {
    // 23503: the subscriptions FK refused it. Deleting a plan someone is on would orphan their
    // subscription, so archiving is the only route once a plan has been sold.
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "This plan has subscribers and cannot be deleted — archive it instead" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not delete the plan" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: "plan.deleted",
    targetType: "plan",
    targetId: id,
    metadata: { code: plan.code, version: plan.version, name: plan.name },
    request,
  });

  return NextResponse.json({ ok: true });
}
