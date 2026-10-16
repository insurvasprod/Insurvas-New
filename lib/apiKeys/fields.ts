/**
 * LA-8.7 · the columns each /api/v1 read selects — an allow-list, so a column added to a table later
 * does not reach an API caller until it is named here. lib/apiKeys/apiKeys.test.mjs holds every list
 * to "no SSN, bank or card field".
 */
export const POLICY_FIELDS = "carrier_id, policy_number, status_normalized, carrier_status_raw, effective_date, issue_date, paid_to_date, termination_date, premium_cents, premium_mode, annualised_premium_cents, face_amount_cents, product_code, risk_band, as_of";

export const COMMISSION_FIELDS = "id, carrier_id, policy_number, entry_type, corrects_type, reverses_entry_id, transaction_date, statement_date, rate_bp, commissionable_premium_cents, months_advanced, amount_cents, agent_user_id, payee_level, created_at";

export const LEAD_FIELDS = "id, created_at, updated_at, product_line, pipeline_id, stage_id, campaign_id, values";
