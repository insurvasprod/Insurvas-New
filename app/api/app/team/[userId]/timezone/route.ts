import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { MembershipRefusal, TeamSchemaPendingError, setMemberTimezone } from "@/lib/tenantTeam/membership";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * LA-8.6 · PUT { timezone: "Asia/Manila" | null } — the member's own zone, for the roster and
 * scorecards. It never changes calling windows, which follow the customer's state. Owners only.
 */
const bodySchema = z.object({ timezone: z.string().trim().min(1).max(64).nullable() }).strict();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a time zone" }, { status: 400 });
  try {
    const before = await memberSnapshot(auth.context.tenantId, userId);
    const timezone = await setMemberTimezone(auth.context.tenantId, userId, parsed.data.timezone);
    await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.timezone`, label: `${before.name} — time zone`, from: before.timezone, to: timezone }] });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.member_timezone_set", targetType: "user", targetId: userId, metadata: { tenantId: auth.context.tenantId, timezone }, request });
    return NextResponse.json({ ok: true, timezone });
  } catch (error) {
    if (error instanceof TeamSchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    if (error instanceof MembershipRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Could not save the time zone" }, { status: 500 });
  }
}
