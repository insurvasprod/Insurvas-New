import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readSplits, saveSplit } from "@/lib/agency/moneyStores";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/** AG-1.6 · policies two producers share; the split divides the writer's pool after the override. */
export async function GET() {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ splits: await readSplits(auth.context.tenantId) }, { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const splitSchema = z.object({
  carrierId: z.string().uuid("Choose the carrier"),
  policyNumber: z.string().trim().min(1, "Enter the policy number").max(100),
  writerUserId: z.string().uuid("Choose the writing producer"),
  // integer basis points; an empty list removes the split. The database refuses anything not totalling 10000.
  shares: z.array(z.object({ producerUserId: z.string().uuid(), shareBps: z.number().int().min(1).max(10000) }).strict()).max(10),
}).strict();

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = splitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the split" }, { status: 400 });
  try {
    const setId = await saveSplit({ tenantId: auth.context.tenantId, ...parsed.data, actorId: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.split_saved", targetType: "policy", targetId: parsed.data.policyNumber, metadata: { tenantId: auth.context.tenantId, carrierId: parsed.data.carrierId, shares: parsed.data.shares, setId }, request });
    return NextResponse.json({ ok: true, setId });
  } catch (error) {
    return refusalResponse(error);
  }
}
