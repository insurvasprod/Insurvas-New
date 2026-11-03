import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { buildRun, listRuns, PayoutError } from "@/lib/accounting/payoutStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-7.4 (Notion sprint) · partner payout runs: the list, and drafting one for a partner and period
 * from its terms. A draft is the agency's alone until it is published. Owner and bookkeeper only.
 */
const ROLES = ["owner", "bookkeeper"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({ partner_id: z.string().uuid(), period_start: isoDate, period_end: isoDate }).strict();

const fail = (error: unknown) => {
  if (error instanceof PayoutError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[payouts]", error);
  return NextResponse.json({ error: "The payout run could not be saved" }, { status: 500 });
};

export async function GET() {
  const auth = await requireFeatureRole("payout_runs", ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listRuns(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("payout_runs", ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a partner and a period." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const id = await buildRun(tenantId, userId, parsed.data.partner_id, parsed.data.period_start, parsed.data.period_end);
    await audit({ actorType: "tenant", actorId: userId, action: "accounting.payout_run_created", targetType: "payout_run", targetId: id, metadata: { tenantId, partnerId: parsed.data.partner_id, from: parsed.data.period_start, to: parsed.data.period_end }, request });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
