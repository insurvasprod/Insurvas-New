import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { HandOverRefusal, handOverMemberWork } from "@/lib/tenantTeam/handOver";
import { describeOpenWork, OPEN_WORK_KINDS, type OpenWork } from "@/lib/tenantTeam/openWork";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { memberSnapshot, recordSettingsChanges } from "@/lib/settingsAudit/record";

/**
 * Settings round 8 · "Hand over now": move a teammate's open work (claimed leads, callbacks, upcoming
 * appointments, queue items, reinstatement cases, servicing follow-ups) to another teammate and keep the
 * person active. Owners only, like deactivation. 503 until 20261112310000 is applied.
 */
const bodySchema = z.object({ to: z.string().uuid() }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Choose who takes the work over" }, { status: 400 });
  try {
    const { moved } = await handOverMemberWork({ tenantId: auth.context.tenantId, userId, actorId: auth.context.userId, to: parsed.data.to });
    const work = Object.fromEntries(OPEN_WORK_KINDS.map((kind) => [kind, Number(moved[kind] ?? 0)])) as OpenWork;
    const said = describeOpenWork(work);
    if (said) {
      const [from, to] = await Promise.all([memberSnapshot(auth.context.tenantId, userId), memberSnapshot(auth.context.tenantId, parsed.data.to)]);
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "team-access", changes: [{ key: `member:${userId}.open_work`, label: `${from.name} — open work`, from: `${said} with ${from.name}`, to: `handed to ${to.name}` }] });
    }
    return NextResponse.json({ ok: true, moved: work });
  } catch (error) {
    if (error instanceof HandOverRefusal) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[team] hand-over failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not hand the work over" }, { status: 500 });
  }
}
