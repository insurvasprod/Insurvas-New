import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { PAID_METHODS } from "@/lib/accounting/invoicesCore";
import { ProducerError, producerRunAction } from "@/lib/accounting/producerStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.5 (Notion sprint) · a producer payout run: publish (books the cost and takes it off the
 * balance), mark paid, void. No money is moved from here. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }).strict(),
  z.object({ action: z.literal("paid"), paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(PAID_METHODS).nullable(), reference: z.string().trim().max(200).nullable() }).strict(),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(1).max(500) }).strict(),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    await producerRunAction(tenantId, userId, id, b.action === "publish" ? { kind: "publish" } : b.action === "paid" ? { kind: "paid", paidOn: b.paid_on, method: b.method, reference: b.reference } : { kind: "void", reason: b.reason });
    await audit({ actorType: "tenant", actorId: userId, action: b.action === "publish" ? "accounting.payout_run_published" : b.action === "paid" ? "accounting.payout_run_paid" : "accounting.payout_run_voided", targetType: "producer_payout_run", targetId: id, metadata: { tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ProducerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[producer-runs]", error);
    return NextResponse.json({ error: "That didn't save" }, { status: 500 });
  }
}
