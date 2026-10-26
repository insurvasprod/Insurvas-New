import type { AppointmentRow, LicenseRow } from "./service-types";

export type EligibilityVault = {
  tenantCarriers: Array<{ carrier_id: string; effective_from: string }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
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

/**
 * canWrite says why. E&O cover and continuing education were removed from the platform (owner
 * decision 2026-10-26), so the rule is the carrier contract, the appointment and the licence — nothing
 * else. The SQL twin is can_write / can_write_reason (migration 20261026400000).
 */
export type CanWriteReason = "ok" | "no_contract" | "no_appointment" | "no_licence";

export type CanWriteResult = {
  allowed: boolean;
  reason: CanWriteReason;
};

/** canWrite with its reason, so callers can tell "no contract" from "no appointment" from "no licence". */
export function canWriteReasonFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string): CanWriteResult {
  const normalizedState = state.trim().toUpperCase();
  const hasContract = vault.tenantCarriers.some((row) => row.carrier_id === carrierId && row.effective_from <= asOf);
  if (!hasContract) return { allowed: false, reason: "no_contract" };
  if (!hasAppointmentAt(vault, carrierId, normalizedState, asOf)) return { allowed: false, reason: "no_appointment" };
  if (!vault.licenses.some((row) => row.state === normalizedState && row.expires_at >= asOf)) return { allowed: false, reason: "no_licence" };
  return { allowed: true, reason: "ok" };
}

function hasAppointmentAt(vault: EligibilityVault, carrierId: string, normalizedState: string, asOf: string): boolean {
  return vault.appointments.some((row) => {
    if (row.carrier_id !== carrierId || row.state !== normalizedState || row.effective_from > asOf) return false;
    // A pending appointment has not been granted; an expired one no longer is.
    if (row.expires_at && row.expires_at < asOf) return false;
    if (row.status === "active") return !row.terminated_at || row.terminated_at > asOf;
    // A policy written before a termination stays writable at its own date (Notion, LA-0.5).
    return row.status === "terminated" && row.terminated_at !== null && row.terminated_at > asOf;
  });
}

/** One eligibility rule for every caller: appointment, carrier contract and licence. */
export function canWriteFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string): boolean {
  return canWriteReasonFromVault(vault, carrierId, state, asOf).allowed;
}
