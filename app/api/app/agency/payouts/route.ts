import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { commitPayout, payoutPreview, readRuns } from "@/lib/agency/payoutStore";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE, periodOf } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/**
 * AG-1.7 · the producer payout run. GET is the PREVIEW for a period (nothing is written) plus the runs already
 * made; POST commits the owner's decision per producer — once per producer and period.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const period = periodOf(new URL(request.url));
  if (period instanceof NextResponse) return period;
  try {
    const [preview, runs] = await Promise.all([payoutPreview(auth.context.tenantId, period.from, period.to), readRuns(auth.context.tenantId)]);
    return NextResponse.json({ period, preview, runs }, { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const commitSchema = z.object({
  from: iso,
  to: iso,
  paidOn: iso,
  method: z.string().trim().min(1, "Enter how you paid").max(60),
  reference: z.string().trim().max(120).nullable().optional(),
  decisions: z.array(z.object({
    producerUserId: z.string().uuid(),
    mode: z.enum(["pay_full", "withhold", "amount"]),
    amountCents: z.number().int().min(0).nullable().optional(),
    reason: z.string().trim().max(300).nullable().optional(),
  }).strict()).min(1, "Choose at least one producer to pay").max(500),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = commitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the payout run" }, { status: 400 });
  if (parsed.data.to < parsed.data.from) return NextResponse.json({ error: "The period ends before it starts." }, { status: 400 });
  try {
    const runs = await commitPayout({ tenantId: auth.context.tenantId, ...parsed.data, reference: parsed.data.reference ?? null, actorId: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.payout_run_committed", targetType: "tenant", targetId: auth.context.tenantId, metadata: { tenantId: auth.context.tenantId, from: parsed.data.from, to: parsed.data.to, runs }, request });
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    return refusalResponse(error);
  }
}
