import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { normalizePlan, planProblem, type PayModel, type PayPlan } from "./payPlanCore";
import { AgencyRefusal, toRefusal } from "./rpc";

/**
 * Team payouts › Pay plans (owner's Accounting doc, round 1 boards T1–T2, 2026-11-07). One dated row per change
 * (producer_pay_plan, 20261107100000): a new start date is a new row, the same date is corrected in place, and a
 * plan is never deleted — months already paid keep the plan they were paid on.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type TeamMember = { userId: string; name: string; status: string; plan: (PayPlan & { id: string }) | null; next: (PayPlan & { id: string }) | null };

const toPlan = (r: Record<string, unknown>): PayPlan & { id: string } => ({
  id: r.id as string,
  model: r.model as PayModel,
  baseCents: Number(r.base_cents),
  salesPctBp: r.sales_pct_bp === null ? null : Number(r.sales_pct_bp),
  appBonusCents: Number(r.app_bonus_cents),
  saveFeeCents: Number(r.save_fee_cents),
  chargebacksApply: Boolean(r.chargebacks_apply),
  effectiveFrom: r.effective_from as string,
});

/** Everyone who can be paid (not invited yet), with the plan in force today and any plan dated later. */
export async function listTeamPlans(tenantId: string, today = new Date().toISOString().slice(0, 10)): Promise<{ team: TeamMember[]; pending: boolean }> {
  const [people, plans] = await Promise.all([
    db().from("producer").select("user_id, display_name, status").eq("tenant_id", tenantId).neq("status", "invited").order("display_name"),
    db().from("producer_pay_plan").select("id, producer_user_id, model, base_cents, sales_pct_bp, app_bonus_cents, save_fee_cents, chargebacks_apply, effective_from").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
  ]);
  if (people.error) throw new Error(`listTeamPlans: ${people.error.message}`);
  // Before the Team pay plans update (20261107100000) there is no plan table: everyone is listed with no plan.
  const pending = !!plans.error && (toRefusal(plans.error) as AgencyRefusal).code === "schema_pending";
  if (plans.error && !pending) throw toRefusal(plans.error);
  const byUser = new Map<string, Array<PayPlan & { id: string }>>();
  for (const r of (plans.data ?? []) as Array<Record<string, unknown>>) {
    const list = byUser.get(r.producer_user_id as string) ?? [];
    list.push(toPlan(r));
    byUser.set(r.producer_user_id as string, list);
  }
  const team = ((people.data ?? []) as Array<Record<string, unknown>>).map((p) => {
    const list = byUser.get(p.user_id as string) ?? [];
    const plan = list.find((x) => x.effectiveFrom <= today) ?? null;
    const next = list.filter((x) => x.effectiveFrom > today).at(-1) ?? null;
    return { userId: p.user_id as string, name: (p.display_name as string) || "Team member", status: p.status as string, plan, next };
  });
  return { team, pending };
}

export async function teamMember(tenantId: string, userId: string): Promise<TeamMember | null> {
  return (await listTeamPlans(tenantId)).team.find((m) => m.userId === userId) ?? null;
}

/** Save a plan. Refuses a shape the database would refuse, in words. */
export async function savePayPlan(tenantId: string, by: string, userId: string, input: PayPlan): Promise<string> {
  const plan = normalizePlan(input);
  const problem = planProblem(plan);
  if (problem) throw new AgencyRefusal(problem, "bad_plan", 400);
  const { data: person } = await db().from("producer").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).neq("status", "invited").maybeSingle();
  if (!person) throw new AgencyRefusal("Only people on your team can have a pay plan.", "not_a_producer", 404);
  const row = {
    tenant_id: tenantId, producer_user_id: userId, model: plan.model, base_cents: plan.baseCents, sales_pct_bp: plan.salesPctBp,
    app_bonus_cents: plan.appBonusCents, save_fee_cents: plan.saveFeeCents, chargebacks_apply: plan.chargebacksApply, effective_from: plan.effectiveFrom,
    created_by: by, updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("producer_pay_plan").upsert(row, { onConflict: "tenant_id,producer_user_id,effective_from" }).select("id").single();
  if (error) throw toRefusal(error);
  return data.id as string;
}
