import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listTeamPlans, savePayPlan } from "@/lib/agency/payPlanStore";
import { PAY_MODELS } from "@/lib/agency/payPlanCore";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/**
 * Team payouts › Pay plans (owner's Accounting doc, 2026-11-07): GET everyone's plan, POST one person's plan from
 * a start date. Owner and bookkeeper, as the payout run.
 */
export async function GET() {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listTeamPlans(auth.context.tenantId), { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const cents = z.number().int().min(0).max(100_000_000);
const schema = z.object({
  userId: z.string().uuid(),
  model: z.enum(PAY_MODELS),
  baseCents: cents,
  salesPctBp: z.number().int().min(0).max(10000).nullable(),
  appBonusCents: cents,
  saveFeeCents: cents,
  chargebacksApply: z.boolean(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the plan starts."),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the plan" }, { status: 400 });
  const { userId, ...plan } = parsed.data;
  try {
    const id = await savePayPlan(auth.context.tenantId, auth.context.userId, userId, plan);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.pay_plan_saved", targetType: "producer_pay_plan", targetId: id, metadata: { tenantId: auth.context.tenantId, producerUserId: userId, model: plan.model, effectiveFrom: plan.effectiveFrom }, request });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return refusalResponse(error);
  }
}
