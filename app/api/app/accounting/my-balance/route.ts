import { NextResponse } from "next/server";

import { myBalance, ProducerError } from "@/lib/accounting/producerStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { canSeeProducerRow } from "@/lib/agency/visibility";

/**
 * LA-7.5 (Notion sprint) · a producer's own split balance, entries and payout runs — never anyone
 * else's (the session's own user id is the only id this route reads), and never an agency-level
 * commission figure (producerView carries share amounts only).
 */
const ROLES = ["producer"] as const;

export async function GET() {
  const auth = await requireFeatureRole("profit_and_loss", ROLES);
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · the one producer this route reads is the session's own user (never an id from the request); the
  // check makes that explicit: if the agency scope ever excluded him (e.g. a failed scope read closes to []),
  // nothing is returned rather than a balance.
  if (!(await canSeeProducerRow(auth.context, auth.context.userId))) return NextResponse.json({ error: "Your balance could not be loaded" }, { status: 404 });
  try {
    return NextResponse.json(await myBalance(auth.context.tenantId, auth.context.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProducerError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[my-balance]", error);
    return NextResponse.json({ error: "Your balance could not be loaded" }, { status: 500 });
  }
}
