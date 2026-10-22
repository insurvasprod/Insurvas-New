import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { readAttribution, resolveAttribution } from "@/lib/agency/moneyStores";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/** AG-1.4 · statement rows we could not safely give to one producer: disagreements and unattributed rows. */
export async function GET() {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ items: await readAttribution(auth.context.tenantId) }, { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const resolveSchema = z.object({
  itemId: z.string().uuid(),
  producerUserId: z.string().uuid("Choose the producer"),
  reason: z.string().trim().min(1, "Say why").max(500),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the decision" }, { status: 400 });
  try {
    await resolveAttribution(auth.context.tenantId, parsed.data.itemId, parsed.data.producerUserId, parsed.data.reason, auth.context.userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.attribution_resolved", targetType: "attribution_item", targetId: parsed.data.itemId, metadata: { tenantId: auth.context.tenantId, producerUserId: parsed.data.producerUserId, reason: parsed.data.reason }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusalResponse(error);
  }
}
