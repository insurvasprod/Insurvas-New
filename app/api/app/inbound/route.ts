import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getTransferInbox } from "@/lib/transferInbox/service";

const safeFilter = (label: string, max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f<>]+$/, `${label} contains unsupported characters`);

const filtersSchema = z.object({
  status: z.enum(["unclaimed", "claimed", "all"]).default("unclaimed"),
  partner_id: z.string().uuid().optional(),
  product_line: safeFilter("Product", 100).optional(),
  state: safeFilter("State", 20).optional(),
  screening_outcome: safeFilter("Screening result", 80).optional(),
  claimed_by: z.union([z.literal("me"), z.string().uuid()]).optional(),
});

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose valid inbox filters" }, { status: 400 });
  try {
    const data = await getTransferInbox(auth.context.tenantId, { status: parsed.data.status, partnerId: parsed.data.partner_id, productLine: parsed.data.product_line, state: parsed.data.state, screeningOutcome: parsed.data.screening_outcome, claimedBy: parsed.data.claimed_by }, auth.context.userId, auth.context.role);
    return NextResponse.json({ ...data, currentUserId: auth.context.userId, readOnly: auth.entitlement.status === "suspended" || auth.entitlement.status === "paused", fetchedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load transfer inbox" }, { status: 500 });
  }
}
