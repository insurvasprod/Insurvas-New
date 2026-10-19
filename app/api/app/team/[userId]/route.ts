import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";
import { updateTeamRoleSchema } from "@/lib/tenantTeam/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { z } from "zod";
import { getEntitlement } from "@/lib/entitlements/get";
import { AgencyRoleRefusal, memberTitles, setMemberAgencyRole } from "@/lib/agency/titles";
import { isAgencyTitle } from "@/lib/tenantAuth/roles";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  }
  const parsed = updateTeamRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a valid role" }, { status: 400 });
  }

  // AG-0.2 · owner and admin are the keys to the agency. Only the owner who holds billing hands them out or
  // takes them away; an admin manages everyone else.
  const targetRow = await getSupabaseServiceClient().from("tenant_users").select("role").eq("tenant_id", auth.context.tenantId).eq("user_id", userId).maybeSingle<{ role: string }>();
  const targetTitle = (await memberTitles(auth.context.tenantId)).get(userId) ?? null;
  const touchesKeys = parsed.data.role === "owner" || parsed.data.role === "admin" || targetRow.data?.role === "owner";
  if (touchesKeys && auth.context.memberRole === "admin") {
    return NextResponse.json({ error: "Only the account owner can grant or remove owner and admin.", code: "owner_only" }, { status: 403 });
  }

  // AG-0.2 · an agency title goes through its one SQL writer, which also checks the plan is an agency plan.
  if (isAgencyTitle(parsed.data.role)) {
    try {
      const granted = await setMemberAgencyRole(auth.context.tenantId, userId, parsed.data.role);
      const from = targetTitle ?? targetRow.data?.role ?? null;
      if (from !== parsed.data.role) {
        await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.member_role_changed", targetType: "user", targetId: userId, metadata: { tenantId: auth.context.tenantId, from, to: parsed.data.role, base: granted.role }, request });
        const who = await memberSnapshot(auth.context.tenantId, userId);
        await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.role`, label: `${who.name} — role`, from, to: parsed.data.role }] });
      }
      return NextResponse.json({ ok: true, userId, role: parsed.data.role });
    } catch (error) {
      if (error instanceof AgencyRoleRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  }

  const entitlement = await getEntitlement(auth.context.tenantId);
  const { data, error } = await getSupabaseServiceClient().rpc("tenant_update_member_role_with_limit", {
    p_tenant_id: auth.context.tenantId,
    p_user_id: userId,
    p_role: parsed.data.role,
    p_max_buffer_seats: entitlement.limits.max_buffer_seats,
  });

  if (error) {
    const limit = error.message?.match(/max_buffer_seats:(\d+):(\d+)/);
    if (limit) return NextResponse.json({ error: `Your plan has reached its buffer-agent seat limit (${limit[1]} of ${limit[2]} buffer seats). Upgrade to add another buffer agent.`, code: "limit_reached", limitKey: "max_buffer_seats", usage: Number(limit[1]), limit: Number(limit[2]), upgrade: true }, { status: 403 });
    if (error.message?.includes("last_owner")) {
      return NextResponse.json({ error: "This is the tenant's only owner. Promote another owner before changing this role.", code: "last_owner" }, { status: 409 });
    }
    if (error.message?.includes("member_not_found")) return NextResponse.json({ error: "That teammate is not in this workspace" }, { status: 404 });
    const setters = error.message?.match(/max_setter_seats:(\d+):(\d+)/);
    if (setters) return NextResponse.json({ error: `Your plan has reached setter seats (${setters[1]} of ${setters[2]}). Upgrade to change another teammate into a setter.`, code: "limit_reached", limitKey: "max_setter_seats", usage: Number(setters[1]), limit: Number(setters[2]), upgrade: true }, { status: 403 });
    return NextResponse.json({ error: "Could not change this teammate's role" }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result.old_role !== result.new_role) {
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_role_changed",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, from: result.old_role, to: result.new_role },
      request,
    });
    const who = await memberSnapshot(auth.context.tenantId, userId);
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.role`, label: `${who.name} — role`, from: result.old_role, to: result.new_role }] });
  }

  return NextResponse.json({ ok: true, userId, role: result.new_role });
}
