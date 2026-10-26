import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";
import { guardWorkItem } from "@/lib/transferInbox/scope";
import { announceTransferClaim, claimNextTransfer, ClaimNextError, claimWasResumed } from "@/lib/transferInbox/service";

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
    // AG-0.5: claim_next_transfer only ever takes an UNCLAIMED live transfer, and every path that sets a
    // row back to 'unclaimed' clears owner_user_id — so what it hands out is nobody's row yet, which
    // AG-0.10 lets anyone who takes transfers claim (there is a caller on the line). The scope therefore
    // narrows nothing here; it is read to hold that invariant: in an agency, a claim that comes back
    // with a work item this session still may not see is refused rather than announced.
    const scope = await scopeFor(auth.context);
    const claim = await claimNextTransfer({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      role: auth.context.role,
      partnerId: parsed.data.partner_id,
      productLine: parsed.data.product_line,
      state: parsed.data.state,
      screeningOutcome: parsed.data.screening_outcome,
    });
    if (scope !== null) {
      const hidden = await guardWorkItem(auth.context, claim.work_item_id, scope);
      if (hidden) {
        console.error("[claim-next] AG-0.5 invariant broken: claimed a work item outside the session's scope", claim.work_item_id);
        return hidden;
      }
    }
    const { chatPosted } = await announceTransferClaim({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, workItemId: claim.work_item_id, claim, request, via: "claim_next" });
    // resumed: this re-claim reopened the verification the transfer had when it was given back (LA-1.11-6).
    return NextResponse.json({ claim, chatPosted, resumed: claimWasResumed(claim) });
  } catch (error) {
    if (error instanceof ClaimNextError) {
      const status = error.code === "no_transfer_waiting" ? 404 : error.code === "role_not_allowed" ? 403 : error.code === "language_not_spoken" ? 409 : error.code === "agent_on_break" || error.code === "not_licensed" ? 409 : error.code === "schema_pending" ? 503 : 500;
      return NextResponse.json({ error: error.message, code: error.code.toUpperCase() }, { status });
    }
    return NextResponse.json({ error: "Could not claim the next transfer." }, { status: 500 });
  }
}
