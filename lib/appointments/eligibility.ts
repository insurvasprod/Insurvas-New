import type { AppointmentRow, EoPolicyRow, LicenseRow } from "./service-types";

export type EligibilityVault = {
  tenantCarriers: Array<{ carrier_id: string; effective_from: string }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
};

/** One eligibility rule for every caller: appointment, carrier contract, licence and E&O. */
export function canWriteFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string): boolean {
  const normalizedState = state.trim().toUpperCase();
  const hasContract = vault.tenantCarriers.some((row) => row.carrier_id === carrierId && row.effective_from <= asOf);
  const hasAppointment = vault.appointments.some((row) => {
    if (row.carrier_id !== carrierId || row.state !== normalizedState || row.effective_from > asOf) return false;
    if (row.status === "active") return !row.terminated_at || row.terminated_at > asOf;
    return row.status === "terminated" && row.terminated_at !== null && row.terminated_at > asOf;
  });
  const hasLicence = vault.licenses.some((row) => row.state === normalizedState && row.expires_at >= asOf);
  const hasEo = vault.eoPolicies.some((row) => row.expires_at >= asOf);
  return hasContract && hasAppointment && hasLicence && hasEo;
}
