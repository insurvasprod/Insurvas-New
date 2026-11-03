import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { getRun, markRunPaid, PayoutError, publishRun, raiseAgentDispute, resolveDispute, voidRun } from "@/lib/accounting/payoutStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.4 (Notion sprint) · one payout run: read it (with exactly what the partner will see), dispute
 * an item while it is a draft, resolve a dispute, publish (creates the cost and shows it to the
 * partner), mark paid, void. No money is moved from here. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }).strict(),
  z.object({ action: z.literal("paid"), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(PAID_METHODS).nullable(), reference: z.string().trim().max(200).nullable() }).strict(),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal("dispute"), item_id: z.string().uuid(), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("resolve"), dispute_id: z.string().uuid(), status: z.enum(["accepted", "upheld"]), note: z.string().trim().min(1).max(1000) }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[payouts]", error);
  return NextResponse.json({ error: "The payout run could not be saved" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("payout_runs", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ run: await getRun(auth.context.tenantId, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("payout_runs", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    if (b.action === "publish") {
      await publishRun(tenantId, id, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_run_published", targetType: "payout_run", targetId: id, metadata: { tenantId }, request });
    } else if (b.action === "paid") {
      await markRunPaid(tenantId, id, { paidOn: b.paid_on, method: b.method, reference: b.reference });
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_run_paid", targetType: "payout_run", targetId: id, metadata: { tenantId, paidOn: b.paid_on }, request });
    } else if (b.action === "void") {
      const reversed = await voidRun(tenantId, id, b.reason, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_run_voided", targetType: "payout_run", targetId: id, metadata: { tenantId, reversed }, request });
    } else if (b.action === "dispute") {
      const disputeId = await raiseAgentDispute(tenantId, id, b.item_id, b.reason, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_dispute", targetType: "payout_dispute", targetId: disputeId, metadata: { tenantId, runId: id, raised: true }, request });
    } else {
      await resolveDispute(tenantId, b.dispute_id, b.status, b.note, userId);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_dispute", targetType: "payout_dispute", targetId: b.dispute_id, metadata: { tenantId, runId: id, resolved: b.status }, request });
    }
    return NextResponse.json({ run: await getRun(tenantId, id) });
  } catch (error) {
    return fail(error);
  }
}
