export type AppointmentRow = {
  id: string; tenant_id: string; carrier_id: string; state: string; status: "active" | "terminated";
  effective_from: string; terminated_at: string | null; created_at: string; updated_at: string;
};
export type LicenseRow = {
  id: string; tenant_id: string; state: string; license_number: string; expires_at: string; created_at: string; updated_at: string;
};
export type EoPolicyRow = {
  id: string; tenant_id: string; carrier: string; policy_number: string; expires_at: string;
  coverage_amount_cents: number; created_at: string; updated_at: string;
};
export type CeRecordRow = {
  id: string; tenant_id: string; state: string; credits_required: number; credits_completed: number;
  deadline: string; created_at: string; updated_at: string;
};
