import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { announceTransferClaim, claimNextTransfer, ClaimNextError } from "@/lib/transferInbox/service";

const safeFilter = (label: string, max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f<>]+$/, `${label} contains unsupported characters`);

/** The inbox's own filters (app/api/app/inbound/route.ts), minus status and claimed-by: "next" is always a waiting transfer. */
const bodySchema = z.object({
  partner_id: z.string().uuid().optional(),
  product_line: safeFilter("Product", 100).optional(),
  state: safeFilter("State", 20).optional(),
  screening_outcome: safeFilter("Screening result", 80).optional(),
}).strict();

/**
 * Claim the oldest waiting inbound transfer that matches the inbox filters. The pick happens in
 * the database (claim_next_transfer, FOR UPDATE SKIP LOCKED), so two agents pressing Claim next at
 * once get two different transfers. The same roles and write gate as Claim transfer.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose valid inbox filters" }, { status: 400 });

  try {
    const claim = await claimNextTransfer({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      role: auth.context.role,
      partnerId: parsed.data.partner_id,
      productLine: parsed.data.product_line,
      state: parsed.data.state,
      screeningOutcome: parsed.data.screening_outcome,
    });
    const { chatPosted } = await announceTransferClaim({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, workItemId: claim.work_item_id, claim, request, via: "claim_next" });
    return NextResponse.json({ claim, chatPosted });
  } catch (error) {
    if (error instanceof ClaimNextError) {
      const status = error.code === "no_transfer_waiting" ? 404 : error.code === "role_not_allowed" ? 403 : error.code === "language_not_spoken" ? 409 : error.code === "schema_pending" ? 503 : 500;
      return NextResponse.json({ error: error.message, code: error.code.toUpperCase() }, { status });
    }
    return NextResponse.json({ error: "Could not claim the next transfer." }, { status: 500 });
  }
}
