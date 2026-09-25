import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { releaseTransfer, TransferReleaseError } from "@/lib/transferInbox/release";

/**
 * Who has a transfer, changed by hand (20260925709860):
 *
 *   unassign    give a transfer being worked back to the queue (the agent who has it, or the owner);
 *   requeue     put a transfer whose call dropped back in the queue, so a re-claim resumes it;
 *   end_buffer  the buffer leaves a call the licensed agent already owns. Not an unassign.
 *
 * Each is one database transaction that writes its own audit row
 * (tenant.transfer_unassigned, tenant.transfer_requeued, tenant.buffer_involvement_ended).
 */
const bodySchema = z.object({
  action: z.enum(["unassign", "requeue", "end_buffer"]),
  work_item_id: z.string().uuid(),
  acknowledge_language: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer and action." }, { status: 400 });
  try {
    const result = await releaseTransfer({ tenantId: auth.context.tenantId, userId: auth.context.userId, workItemId: parsed.data.work_item_id, action: parsed.data.action, acknowledgeLanguage: parsed.data.acknowledge_language });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof TransferReleaseError) return NextResponse.json({ error: error.message, code: error.code, ...(error.detail ? { language: error.detail } : {}) }, { status: error.status });
    return NextResponse.json({ error: "Could not update this transfer." }, { status: 500 });
  }
}
