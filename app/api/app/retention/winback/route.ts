import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { resolveClaim, WinbackError } from "@/lib/retention/winbackStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.7 (Notion sprint) · win-back. Mark a possible claim handled (a lapse after a death: the family
 * was helped, or it was not a death). Releases are not requested here: a candidate goes to the
 * Win-back list when its cooling-off ends, and the database refuses a never-call one.
 *
 * Gated on `winback`; owner and producer (a producer reaches the policies credited to them).
 */
const body = z.object({
  action: z.literal("resolve_claim"),
  id: z.string().refine(isRecordUuid, "Choose the follow-up."),
  note: z.string().trim().max(2000).nullable(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("winback", ["owner", "producer"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    await resolveClaim({ tenantId, userId, role }, parsed.data.id, parsed.data.note);
    await audit({ actorType: "tenant", actorId: userId, action: "retention.claim_followup_resolved", targetType: "household_claim_followup", targetId: parsed.data.id, metadata: { tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WinbackError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[winback]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
