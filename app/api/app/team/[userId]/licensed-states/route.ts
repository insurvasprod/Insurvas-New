import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { licensedStatesSchema } from "@/lib/tenantTeam/schemas";
import { setMemberLicensedStates } from "@/lib/tenantTeam/service";
import { SchemaPendingError, schemaPendingBody } from "@/lib/appointments/pendingSchema";

/**
 * Replaces the states one teammate is personally licensed in. Lead assignment reads these (migration
 * 20260924110000): once any are recorded, an owner or producer is only given leads in those states.
 * `expiries` (optional, by state) records the day each lapses (20260925702000); after it the state
 * no longer counts for assignment or dialing, and the licence-lapse job returns their open leads there.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;

  const { userId } = await params;
  if (!z.string().uuid().safeParse(userId).success) {
    return NextResponse.json({ error: "That teammate identifier is not valid" }, { status: 400 });
  }
  const parsed = licensedStatesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose valid US states" }, { status: 400 });
  }

  try {
    const saved = await setMemberLicensedStates(auth.context.tenantId, userId, [...new Set(parsed.data.states)], parsed.data.expiries);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.member_licensed_states_changed",
      targetType: "user",
      targetId: userId,
      metadata: { tenantId: auth.context.tenantId, states: saved.states, expiries: saved.expiries },
      request,
    });
    return NextResponse.json({ ok: true, userId, licensedStates: saved.states, licensedStateExpiries: saved.expiries });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json(schemaPendingBody(), { status: 503 });
    if (error instanceof Error && error.message === "member_not_found") return NextResponse.json({ error: "That teammate is not in this workspace" }, { status: 404 });
    console.error("[team] failed to save licensed states", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not save this teammate's licensed states" }, { status: 500 });
  }
}
