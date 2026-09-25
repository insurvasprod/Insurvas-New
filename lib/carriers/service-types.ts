/**
 * `applies_onward` (migration 20260924100100) marks the row as covering its own policy year and
 * every later year without a row of its own — the "Year 11+" of a carrier's schedule. Optional
 * because reads tolerate a database that has not had that migration yet (it reads as false).
 */
export type CommissionScheduleRow = { id: string; tenant_id: string; carrier_id: string; product_code: string; contract_level_bp: number; policy_year: number; rate_bp: number; effective_from: string; created_at: string; applies_onward?: boolean };
