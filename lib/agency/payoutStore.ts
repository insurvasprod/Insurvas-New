import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyRpc } from "./rpc";

/**
 * AG-1.7 · the producer payout run. The preview is a READ (agency_payout_preview writes nothing); the commit
 * records the owner's decision per producer and pays through LA-7.5's run machinery, once per producer and period.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type PreviewRow = {
  producerUserId: string;
  displayName: string;
  status: string;
  balanceBeforeCents: number;
  earnedCents: number;
  chargebackCents: number;
  periodCents: number;
  balanceCents: number;
  recommendedMode: "pay_full" | "withhold";
  recommendedPayCents: number;
  recommendedWithholdCents: number;
  negativePolicies: Array<{ carrier_id: string; policy_number: string; amount_cents: number; occurred_on: string }>;
  alreadyRun: boolean;
  /** Team pay plans (20261107100000); null/0 before that update. */
  planModel: string | null;
  salaryCents: number;
  bonusCents: number;
  saveFeeCents: number;
  absorbedCount: number;
};

export async function payoutPreview(tenantId: string, from: string, to: string): Promise<PreviewRow[]> {
  await agencyRpc<number>("agency_ledger_sync", { p_tenant_id: tenantId });
  // Salary, application bonuses and save fees owed up to the month's end (Team pay plans). Before that update the
  // function is missing and the run is commission only, as it was.
  await agencyRpc<number>("sync_producer_pay", { p_tenant_id: tenantId, p_to: to }).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && (error as { code: string }).code === "schema_pending")) throw error;
  });
  const rows = await agencyRpc<Array<Record<string, unknown>>>("agency_payout_preview", { p_tenant_id: tenantId, p_from: from, p_to: to });
  return (rows ?? []).map((r) => ({
    producerUserId: r.producer_user_id as string,
    displayName: r.display_name as string,
    status: r.status as string,
    balanceBeforeCents: Number(r.balance_before_cents),
    earnedCents: Number(r.earned_cents),
    chargebackCents: Number(r.chargeback_cents),
    periodCents: Number(r.period_cents),
    balanceCents: Number(r.balance_cents),
    recommendedMode: r.recommended_mode as "pay_full" | "withhold",
    recommendedPayCents: Number(r.recommended_pay_cents),
    recommendedWithholdCents: Number(r.recommended_withhold_cents),
    negativePolicies: (r.negative_policies ?? []) as PreviewRow["negativePolicies"],
    alreadyRun: Boolean(r.already_run),
    planModel: (r.plan_model as string | null | undefined) ?? null,
    salaryCents: Number(r.salary_cents ?? 0),
    bonusCents: Number(r.bonus_cents ?? 0),
    saveFeeCents: Number(r.save_fee_cents ?? 0),
    absorbedCount: Number(r.absorbed_count ?? 0),
  }));
}

export type Decision = {
  producerUserId: string;
  mode: "pay_full" | "withhold" | "amount" | "recover" | "forgive";
  amountCents?: number | null;
  /** "Take N% this month": N in basis points. */
  pctBp?: number | null;
  reason?: string | null;
  /** Each person paid their own way (Team payouts, round 1 board T5); else the run's. */
  method?: string | null;
  reference?: string | null;
  paidOn?: string | null;
};

export async function commitPayout(input: { tenantId: string; from: string; to: string; decisions: Decision[]; paidOn: string; method: string; reference: string | null; actorId: string }) {
  return agencyRpc<Array<{ producer_user_id: string; run_id: string; net_cents: number; mode: string; taken_cents: number | null; forgiven_cents: number | null }>>("agency_payout_commit", {
    p_tenant_id: input.tenantId,
    p_from: input.from,
    p_to: input.to,
    p_decisions: input.decisions.map((d) => ({
      producer_user_id: d.producerUserId, mode: d.mode, amount_cents: d.amountCents ?? null, pct_bp: d.pctBp ?? null, reason: d.reason ?? null,
      method: d.method ?? null, reference: d.reference ?? null, paid_on: d.paidOn ?? null,
    })),
    p_paid_on: input.paidOn,
    p_method: input.method,
    p_reference: input.reference,
    p_actor: input.actorId,
  });
}

export type RunRow = {
  id: string;
  producerUserId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  netCents: number;
  withheldCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  decisionMode: string | null;
  decisionReason: string | null;
  paidOn: string | null;
  paidMethod: string | null;
  paymentReference: string | null;
};

export async function readRuns(tenantId: string, producerUserId?: string): Promise<RunRow[]> {
  let query = db()
    .from("producer_payout_run")
    .select("id, producer_user_id, period_start, period_end, status, net_cents, withheld_cents, balance_before_cents, balance_after_cents, decision_mode, decision_reason, paid_on, paid_method, payment_reference")
    .eq("tenant_id", tenantId)
    .neq("status", "void")
    .order("period_end", { ascending: false })
    .limit(500);
  if (producerUserId) query = query.eq("producer_user_id", producerUserId);
  const { data, error } = await query;
  if (error) throw new Error(`readRuns: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    producerUserId: r.producer_user_id as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    status: r.status as string,
    netCents: Number(r.net_cents),
    withheldCents: Number(r.withheld_cents),
    balanceBeforeCents: Number(r.balance_before_cents),
    balanceAfterCents: Number(r.balance_after_cents),
    decisionMode: (r.decision_mode as string | null) ?? null,
    decisionReason: (r.decision_reason as string | null) ?? null,
    paidOn: (r.paid_on as string | null) ?? null,
    paidMethod: (r.paid_method as string | null) ?? null,
    paymentReference: (r.payment_reference as string | null) ?? null,
  }));
}

/** Settings › Accounting's rule for anyone below zero: the draft's default choice and its share. */
export async function readPayoutRules(tenantId: string): Promise<{ negativePolicy: string; recoveryPctBp: number }> {
  const { data } = await db().from("accounting_settings").select("producer_negative_policy, producer_recovery_cap_bp").eq("tenant_id", tenantId).maybeSingle();
  const policy = (data?.producer_negative_policy as string | undefined) ?? "carry_forward";
  // The owner's "take it slowly" is 20% of the debt; a cap set in Settings replaces it.
  return { negativePolicy: policy, recoveryPctBp: policy === "cap" ? Number(data?.producer_recovery_cap_bp ?? 2000) : 2000 };
}
