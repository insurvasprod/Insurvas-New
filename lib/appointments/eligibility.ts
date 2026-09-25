import type { AppointmentRow, EoPolicyRow, LicenseRow } from "./service-types";

export type EligibilityVault = {
  tenantCarriers: Array<{ carrier_id: string; effective_from: string }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
};

type AppointmentDates = Pick<AppointmentRow, "status" | "effective_from" | "terminated_at"> & { expires_at?: string | null };

/**
 * Whether an appointment is active for a market on the requested date.
 *
 * 'pending' never counts, and neither does an appointment past its expires_at (migration
 * 20260924310000): an expired appointment stops counting exactly as a terminated one does.
 */
export function appointmentIsActiveAt(row: AppointmentDates, asOf: string): boolean {
  return (
    row.status === "active" &&
    row.effective_from <= asOf &&
    (!row.terminated_at || row.terminated_at > asOf) &&
    (!row.expires_at || row.expires_at >= asOf)
  );
}

/**
 * The appointment half of assignment_candidate_is_eligible, row by row, for the code paths that
 * must answer before (or without) the database function: status 'active', started, not ended and
 * not expired. Ended is inclusive here (terminated_at >= today) because the SQL gate is; keep the
 * two identical rather than "fixing" one of them.
 */
export function appointmentCountsForRouting(
  row: { status: string; effective_from: string | null; terminated_at: string | null; expires_at?: string | null },
  today: string,
): boolean {
  const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
  const effective = day(row.effective_from);
  const terminated = day(row.terminated_at);
  const expires = day(row.expires_at);
  return (
    row.status === "active" &&
    (!effective || effective <= today) &&
    (!terminated || terminated >= today) &&
    (!expires || expires >= today)
  );
}

/** One eligibility rule for every caller: appointment, carrier contract, licence and E&O. */
export function canWriteFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string): boolean {
  const normalizedState = state.trim().toUpperCase();
  const hasContract = vault.tenantCarriers.some((row) => row.carrier_id === carrierId && row.effective_from <= asOf);
  const hasAppointment = vault.appointments.some((row) => {
    if (row.carrier_id !== carrierId || row.state !== normalizedState || row.effective_from > asOf) return false;
    // A pending appointment has not been granted; an expired one no longer is.
    if (row.expires_at && row.expires_at < asOf) return false;
    if (row.status === "active") return !row.terminated_at || row.terminated_at > asOf;
    // A policy written before a termination stays writable at its own date (Notion, LA-0.5).
    return row.status === "terminated" && row.terminated_at !== null && row.terminated_at > asOf;
  });
  const hasLicence = vault.licenses.some((row) => row.state === normalizedState && row.expires_at >= asOf);
  const hasEo = vault.eoPolicies.some((row) => row.expires_at >= asOf);
  return hasContract && hasAppointment && hasLicence && hasEo;
}
