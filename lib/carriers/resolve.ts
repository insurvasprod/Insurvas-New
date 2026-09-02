import type { CommissionScheduleRow } from "./service-types";

export function resolveCommissionRate(rows: CommissionScheduleRow[], input: { carrierId: string; productCode: string; contractLevelBp: number; policyYear: number; asOf: string }): CommissionScheduleRow | null {
  return rows.filter((row) => row.carrier_id === input.carrierId && row.product_code === input.productCode && row.contract_level_bp === input.contractLevelBp && row.policy_year === input.policyYear && row.effective_from <= input.asOf).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** Convert a resolved basis-point schedule rate into integer cents. */
export function commissionCentsFromSchedule(premiumCents: number, schedule: CommissionScheduleRow): number {
  if (!Number.isSafeInteger(premiumCents) || premiumCents < 0) throw new Error("premiumCents must be a non-negative integer");
  if (!Number.isInteger(schedule.rate_bp) || schedule.rate_bp < 0 || schedule.rate_bp > 100000) throw new Error("rate_bp must be an integer basis-point rate");
  return Math.round((premiumCents * schedule.rate_bp) / 10000);
}
