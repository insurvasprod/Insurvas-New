import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { CarrierRow } from "@/lib/carriers/constants";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import type { AppointmentRow, CeRecordRow, EoPolicyRow, LicenseRow } from "./service-types";
import { canWriteFromVault } from "./eligibility";

export type AppointmentVault = {
  carriers: CarrierRow[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
  ceRecords: CeRecordRow[];
};

export async function getAppointmentVault(tenantId: string): Promise<AppointmentVault> {
  const supabase = getSupabaseServiceClient();
  const [carriers, tenantCarriers, appointments, licenses, eoPolicies, ceRecords] = await Promise.all([
    supabase.from("carriers").select("id, code, name, is_active, sort_order, created_at, updated_at").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("tenant_carriers").select("id, tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    supabase.from("appointments").select("id, tenant_id, carrier_id, state, status, effective_from, terminated_at, created_at, updated_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    supabase.from("licenses").select("id, tenant_id, state, license_number, expires_at, created_at, updated_at").eq("tenant_id", tenantId).order("state"),
    supabase.from("eo_policies").select("id, tenant_id, carrier, policy_number, expires_at, coverage_amount_cents, created_at, updated_at").eq("tenant_id", tenantId).order("expires_at"),
    supabase.from("ce_records").select("id, tenant_id, state, credits_required, credits_completed, deadline, created_at, updated_at").eq("tenant_id", tenantId).order("state"),
  ]);
  const error = [carriers, tenantCarriers, appointments, licenses, eoPolicies, ceRecords].find((result) => result.error)?.error;
  if (error) throw new Error(`Could not load appointment vault: ${error.message}`);
  return { carriers: (carriers.data ?? []) as CarrierRow[], tenantCarriers: (tenantCarriers.data ?? []) as TenantCarrierRow[], appointments: (appointments.data ?? []) as AppointmentRow[], licenses: (licenses.data ?? []) as LicenseRow[], eoPolicies: (eoPolicies.data ?? []) as EoPolicyRow[], ceRecords: (ceRecords.data ?? []) as CeRecordRow[] };
}

export async function saveAppointments(tenantId: string, rows: unknown) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_appointments", { p_tenant_id: tenantId, p_rows: rows as Json });
  if (error) throw new Error(error.message);
  return (data ?? []) as AppointmentRow[];
}

export async function saveLicense(tenantId: string, input: { state: string; license_number: string; expires_at: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_license", { p_tenant_id: tenantId, p_state: input.state, p_license_number: input.license_number, p_expires_at: input.expires_at }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save licence"); return data as LicenseRow;
}
export async function saveEoPolicy(tenantId: string, input: { carrier: string; policy_number: string; expires_at: string; coverage_amount_cents: number }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_eo_policy", { p_tenant_id: tenantId, p_carrier: input.carrier, p_policy_number: input.policy_number, p_expires_at: input.expires_at, p_coverage_amount_cents: input.coverage_amount_cents }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save E&O policy"); return data as EoPolicyRow;
}
export async function saveCeRecord(tenantId: string, input: { state: string; credits_required: number; credits_completed: number; deadline: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_ce_record", { p_tenant_id: tenantId, p_state: input.state, p_credits_required: input.credits_required, p_credits_completed: input.credits_completed, p_deadline: input.deadline }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save CE record"); return data as CeRecordRow;
}

export async function canWrite(tenantId: string, carrierId: string, state: string, asOf: string): Promise<boolean> {
  const vault = await getAppointmentVault(tenantId);
  return canWriteFromVault(vault, carrierId, state, asOf);
}

export { canWriteFromVault } from "./eligibility";
