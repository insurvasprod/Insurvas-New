import type { CommissionScheduleRow } from "./service-types";

/**
 * The schedule row that pays `policyYear` of a policy on `asOf`.
 *
 * Effective-dated: the latest row dated on or before `asOf` wins. A row for the exact policy year
 * always wins; failing one, the highest open-ended row (`applies_onward`, "Year 11+") below the
 * year applies. Never invents a rate — no row, no answer.
 */
export function resolveCommissionRate(rows: CommissionScheduleRow[], input: { carrierId: string; productCode: string; contractLevelBp: number; policyYear: number; asOf: string }): CommissionScheduleRow | null {
  const eligible = rows.filter((row) => row.carrier_id === input.carrierId && row.product_code === input.productCode && row.contract_level_bp === input.contractLevelBp && row.effective_from <= input.asOf);
  const latest = (candidates: CommissionScheduleRow[]) => candidates.sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  const exact = latest(eligible.filter((row) => row.policy_year === input.policyYear));
  if (exact) return exact;
  const onward = eligible.filter((row) => row.applies_onward === true && row.policy_year < input.policyYear);
  if (onward.length === 0) return null;
  const from = Math.max(...onward.map((row) => row.policy_year));
  return latest(onward.filter((row) => row.policy_year === from));
}

/** Convert a resolved basis-point schedule rate into integer cents. */
export function commissionCentsFromSchedule(premiumCents: number, schedule: CommissionScheduleRow): number {
  if (!Number.isSafeInteger(premiumCents) || premiumCents < 0) throw new Error("premiumCents must be a non-negative integer");
  if (!Number.isInteger(schedule.rate_bp) || schedule.rate_bp < 0 || schedule.rate_bp > 100000) throw new Error("rate_bp must be an integer basis-point rate");
  return Math.round((premiumCents * schedule.rate_bp) / 10000);
}
