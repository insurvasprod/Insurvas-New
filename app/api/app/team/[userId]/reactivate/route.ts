import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { MembershipRefusal, TeamSchemaPendingError, reactivateMember } from "@/lib/tenantTeam/membership";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";

/** LA-8.6 · POST: make a deactivated teammate active again. Takes a seat, so refused at the limit. Owners only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  try {
    await reactivateMember(auth.context.tenantId, userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.member_reactivated", targetType: "user", targetId: userId, metadata: { tenantId: auth.context.tenantId }, request });
    const who = await memberSnapshot(auth.context.tenantId, userId);
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.status`, label: `${who.name} — access`, from: "deactivated", to: "active" }] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TeamSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    if (error instanceof MembershipRefusal) return NextResponse.json({ error: error.message, code: error.code, upgrade: error.code === "seat_limit" }, { status: error.status });
    console.error("[team] reactivation failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not reactivate this teammate" }, { status: 500 });
  }
}
