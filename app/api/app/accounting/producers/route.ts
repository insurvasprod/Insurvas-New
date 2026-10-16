import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { addSplit, buildProducerRun, ProducerError, producerEntries, producersOverview, syncProducerLedger, writeOff } from "@/lib/accounting/producerStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.5 (Notion sprint) · producer splits, the agency's side: balances, splits (a change is a new
 * effective-dated row), runs, and an explicit write-off with a reason. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_split"), producer_user_id: uuid, carrier_id: uuid.nullable(), product_code: z.string().trim().max(100).nullable(), split_pct_bp: z.number().int().min(0).max(10000), basis: z.enum(["advance", "earned", "both"]), pays_on: z.enum(["advance_received", "first_draft", "issue"]), effective_from: isoDate }).strict(),
  z.object({ op: z.literal("build_run"), producer_user_id: uuid, period_start: isoDate, period_end: isoDate }).strict(),
  z.object({ op: z.literal("write_off"), producer_user_id: uuid, reason: z.string().trim().min(1).max(500) }).strict(),
]);

const fail = (error: unknown) => {
  if (error instanceof ProducerError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[producers]", error);
  return NextResponse.json({ error: "That didn't save" }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { tenantId } = auth.context;
  const producer = request.nextUrl.searchParams.get("producer");
  try {
    if (producer) {
      if (!uuid.safeParse(producer).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ entries: await producerEntries(tenantId, producer) }, { headers: { "Cache-Control": "no-store" } });
    }
    await syncProducerLedger(tenantId);
    return NextResponse.json(await producersOverview(tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("profit_and_loss", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const b = parsed.data;
  try {
    if (b.op === "add_split") {
      const id = await addSplit(tenantId, userId, { producerUserId: b.producer_user_id, carrierId: b.carrier_id, productCode: b.product_code, splitPctBp: b.split_pct_bp, basis: b.basis, paysOn: b.pays_on, effectiveFrom: b.effective_from });
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.producer_split_saved", targetType: "producer_split", targetId: id, metadata: { tenantId, producer: b.producer_user_id, bp: b.split_pct_bp, from: b.effective_from }, request });
      return NextResponse.json({ id }, { status: 201 });
    }
    if (b.op === "build_run") {
      const id = await buildProducerRun(tenantId, userId, b.producer_user_id, b.period_start, b.period_end);
      await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_run_created", targetType: "producer_payout_run", targetId: id, metadata: { tenantId, producer: b.producer_user_id }, request });
      return NextResponse.json({ id }, { status: 201 });
    }
    const amount = await writeOff(tenantId, userId, b.producer_user_id, b.reason);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.producer_write_off", targetType: "producer", targetId: b.producer_user_id, metadata: { tenantId, amountCents: amount, reason: b.reason }, request });
    return NextResponse.json({ writtenOffCents: amount });
  } catch (error) {
    return fail(error);
  }
}
