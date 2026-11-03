import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { MembershipRefusal, TeamSchemaPendingError, deactivateMember, memberOpenWork } from "@/lib/tenantTeam/membership";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * LA-8.6 · deactivating a teammate. GET: what is still open in their name. POST: hand it to the
 * teammate named in `reassignTo`, then switch the account off — sessions end on their next request,
 * the seat is freed, and everything they did stays attributed to them. Refused (409, with the open
 * work) while work is open and nobody is named. Owners only.
 */
const bodySchema = z.object({ reassignTo: z.string().uuid().nullable().default(null) }).strict();

function failure(error: unknown) {
  if (error instanceof TeamSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
  if (error instanceof MembershipRefusal) return NextResponse.json({ error: error.message, code: error.code, openWork: error.openWork }, { status: error.status });
  console.error("[team] deactivation failed", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "Could not deactivate this teammate" }, { status: 500 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  try {
    return NextResponse.json({ openWork: await memberOpenWork(auth.context.tenantId, userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Choose who takes the work over" }, { status: 400 });
  try {
    const result = await deactivateMember({ tenantId: auth.context.tenantId, userId, actorId: auth.context.userId, reassignTo: parsed.data.reassignTo });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_deactivated",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, role: result.role, openWork: result.open, moved: result.moved, reassignedTo: parsed.data.reassignTo },
      request,
    });
    const who = await memberSnapshot(auth.context.tenantId, userId);
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.status`, label: `${who.name} — access`, from: "active", to: "deactivated" }] });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
