import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { partnerStatementFor, PayoutError, raisePartnerDispute } from "@/lib/accounting/payoutStore";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";

/**
 * LA-7.4 (Notion sprint) · one of the partner's own statements, and raising a dispute on it. The
 * payload is the whitelist in partnerStatement(): rejected transfers as a count only, revenue share
 * as one total, no commission figure. Another partner's run, or a draft, is simply "Not found".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({
  item_id: z.string().uuid().nullable(),
  reason: z.string().trim().min(1).max(1000),
  // At most what it disputes (an item, or the run's gross) — checked against the run in raisePartnerDispute and the database; this is the outer bound, the same $1,000,000 as every LA-7 money setting.
  claim_cents: z.number().int().min(0).max(100_000_000),
}).strict();

const fail = (error: unknown) => {
  if (error instanceof PayoutError) return NextResponse.json({ error: error.status === 503 ? "Statements are not available yet." : error.message }, { status: error.status });
  console.error("[partner-payouts]", error);
  return NextResponse.json({ error: "That didn't work" }, { status: 500 });
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const statement = await partnerStatementFor(auth.context.tenantId, auth.context.partnerId, id);
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ statement }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Say what is wrong." }, { status: 400 });
  const { context } = auth;
  try {
    await raisePartnerDispute(context.tenantId, context.partnerId, context.userId, id, { itemId: parsed.data.item_id, reason: parsed.data.reason, claimCents: parsed.data.claim_cents });
    return NextResponse.json({ statement: await partnerStatementFor(context.tenantId, context.partnerId, id) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
