/**
 * 'pending' (applied for, not yet confirmed by the carrier) and expires_at arrive with migration
 * 20260924310000. Only an 'active' row inside its dates counts toward routing a lead.
 */
export type AppointmentStatus = "pending" | "active" | "terminated";
export type AppointmentRow = {
  id: string; tenant_id: string; carrier_id: string; state: string; status: AppointmentStatus;
  effective_from: string; terminated_at: string | null; created_at: string; updated_at: string;
  /** Migration 20260924310000. Absent until applied; null means the appointment does not expire. */
  expires_at?: string | null;
};
/** A carrier's own training requirement (migration 20260924310100). Outstanding until completed_on is set. */
export type CarrierTrainingRow = {
  id: string; tenant_id: string; carrier_id: string; title: string; due_on: string;
  completed_on: string | null; updated_at: string; updated_by: string | null;
};
export type LicenceType = "resident" | "non_resident";
export type LicenseRow = {
  id: string; tenant_id: string; state: string; license_number: string; expires_at: string; created_at: string; updated_at: string;
  /** Migration 20260924110000. Absent/null until applied or until recorded. */
  licence_type?: LicenceType | null;
  lines_of_authority?: string[] | null;
};
export type EoPolicyRow = {
  id: string; tenant_id: string; carrier: string; policy_number: string; expires_at: string;
  coverage_amount_cents: number; created_at: string; updated_at: string;
  /** Migration 20260924110000. */
  per_claim_cents?: number | null;
  aggregate_cents?: number | null;
};
export type CeRecordRow = {
  id: string; tenant_id: string; state: string; credits_required: number; credits_completed: number;
  deadline: string; created_at: string; updated_at: string;
  /** Migration 20260924110000. */
  ethics_required?: number | null;
  ethics_completed?: number | null;
};

/** Lines of authority a licence can carry, in the order the form offers them. */
export const LINES_OF_AUTHORITY = ["Life", "Health", "Accident & Health", "Annuities", "Variable", "Property", "Casualty"] as const;
