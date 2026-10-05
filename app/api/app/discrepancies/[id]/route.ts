import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { DiscrepancyError, SETTABLE_DISCREPANCY_STATUSES, setDiscrepancyStatus } from "@/lib/discrepancies/service";
import { isRecordId } from "@/lib/ledger/statementConstants";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Money boundary (LA-4.4): a person's decision on one discrepancy — disputed (a letter went to the
 * carrier), resolved (the carrier paid), written off (not pursued), or open again. One audit row
 * per decision, with what it was before. "Cleared" is never set by a person: it means the facts
 * changed and the refresh found it no longer applies.
 *
 * Owner and bookkeeper only. A write, so a read-only account is refused.
 */
const roles = ["owner", "bookkeeper"] as const;

const bodySchema = z.object({
  status: z.enum(SETTABLE_DISCREPANCY_STATUSES),
  note: z.string().trim().max(1000).nullish(),
}).strict();

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("discrepancy_report", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isRecordId(id)) return NextResponse.json({ error: "That discrepancy is not in this workspace" }, { status: 404 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the request and try again" }, { status: 400 });
  try {
    const result = await setDiscrepancyStatus(auth.context.tenantId, auth.context.userId, id, body.data.status, body.data.note ?? null);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.discrepancy_status_changed",
      targetType: "tenant_commission_discrepancy",
      targetId: id,
      reason: body.data.note ?? undefined,
      metadata: { tenantId: auth.context.tenantId, from: result.from, to: result.to, kind: result.kind, policyId: result.policyId, owedCents: result.owedCents },
      request,
    });
    return NextResponse.json({ ok: true, id, status: result.to });
  } catch (error) {
    if (error instanceof DiscrepancyError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[discrepancies] status", error);
    return NextResponse.json({ error: "Could not record the decision" }, { status: 500 });
  }
}
