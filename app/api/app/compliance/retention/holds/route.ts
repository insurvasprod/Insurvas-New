import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { RetentionError } from "@/lib/compliance/retentionStore";
import { placeHoldLogged, releaseHoldLogged } from "@/lib/compliance/settingsStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.6 (Notion sprint) · legal holds placed and released by hand. A hold beats the retention
 * schedule and a deletion request. Complaint and dispute holds come from their source and cannot be
 * released while it is open — the database refuses it.
 */
const place = z.object({ scope: z.string(), value: z.string().max(200).nullable().optional(), reason: z.string(), note: z.string().max(2000) }).strict();
const release = z.object({ id: z.string().uuid(), note: z.string().max(2000) }).strict();

const fail = (error: unknown) => {
  if (error instanceof RetentionError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[legal-hold]", error);
  return NextResponse.json({ error: "The hold could not be saved" }, { status: 500 });
};

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = place.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the hold and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await placeHoldLogged(tenantId, userId, { scope: parsed.data.scope, value: parsed.data.value ?? null, reason: parsed.data.reason, note: parsed.data.note });
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.legal_hold_placed", targetType: "legal_hold", targetId: parsed.data.scope, metadata: { tenantId, reason: parsed.data.reason }, request });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = release.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say why the hold is released." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    await releaseHoldLogged(tenantId, userId, parsed.data.id, parsed.data.note);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.legal_hold_released", targetType: "legal_hold", targetId: parsed.data.id, metadata: { tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
